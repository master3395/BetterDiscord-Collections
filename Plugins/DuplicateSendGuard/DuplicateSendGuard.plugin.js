/**
 * @name DuplicateSendGuard
 * @author master3395
 * @version 1.0.1
 * @description Warns before sending a message that matches your own recent message in the same channel.
 * @source https://github.com/master3395/BetterDiscord-Collections
 */

const SLUG = "DuplicateSendGuard";

function loadSettings() {
	return {
		enabled: BdApi.Data.load(SLUG, "enabled") !== false,
		lookback: Math.min(50, Math.max(3, Number(BdApi.Data.load(SLUG, "lookback")) || 15)),
		normalizeWhitespace: BdApi.Data.load(SLUG, "normalizeWhitespace") !== false,
	};
}

function normalize(text, doNorm) {
	if (typeof text !== "string") return "";
	const t = text.trim();
	return doNorm ? t.replace(/\s+/g, " ") : t;
}

function toast(msg, type) {
	try {
		if (BdApi.UI && typeof BdApi.UI.showToast === "function") BdApi.UI.showToast(msg, { type: type || "info" });
	} catch (_e) {}
}

function getMessageStore() {
	try {
		return BdApi.Webpack.getStore("MessageStore");
	} catch (_e) {
		return null;
	}
}

function getUserStore() {
	try {
		return BdApi.Webpack.getStore("UserStore");
	} catch (_e) {
		return null;
	}
}

/** @returns {Array<{content?: string, author?: {id?: string}}>} */
function recentOwnMessages(channelId, userId, limit) {
	const MS = getMessageStore();
	if (!MS || !channelId || !userId) return [];
	let list = [];
	try {
		const bucket = MS.getMessages(channelId);
		if (bucket && typeof bucket.toArray === "function") list = bucket.toArray();
		else if (bucket && Array.isArray(bucket._array)) list = bucket._array;
		else if (bucket && typeof bucket.forEach === "function") {
			bucket.forEach((m) => {
				if (m) list.push(m);
			});
		}
	} catch (_e) {
		return [];
	}
	return list
		.filter((m) => m && m.author && m.author.id === userId && typeof m.content === "string" && m.content.length)
		.slice(-limit);
}

function findSendMessageModule() {
	const { Webpack } = BdApi;
	try {
		const byKeys = Webpack.getByKeys && Webpack.getByKeys("sendMessage", "editMessage");
		if (byKeys && typeof byKeys.sendMessage === "function") return byKeys;
	} catch (_e) {}
	try {
		return Webpack.getModule(
			(m) => m && typeof m.sendMessage === "function" && typeof m.editMessage === "function",
			{ searchExports: true },
		);
	} catch (_e) {}
	return null;
}

function extractSendArgs(args) {
	if (args.length >= 2 && typeof args[0] === "string" && args[1] && typeof args[1] === "object") {
		return { channelId: args[0], payload: args[1] };
	}
	if (args.length >= 1 && args[0] && typeof args[0] === "object" && args[0].channelId) {
		return { channelId: args[0].channelId, payload: args[0] };
	}
	return null;
}

module.exports = class DuplicateSendGuard {
	constructor(meta) {
		this.meta = meta;
	}

	start() {
		const mod = findSendMessageModule();
		if (!mod || typeof mod.sendMessage !== "function") {
			console.warn("[DuplicateSendGuard] sendMessage module not found; plugin inactive on this build.");
			return;
		}
		BdApi.Patcher.instead("DuplicateSendGuard", mod, "sendMessage", (_, args, orig) => {
			const settings = loadSettings();
			if (!settings.enabled) return orig.apply(mod, args);

			const parsed = extractSendArgs(args);
			if (!parsed) return orig.apply(mod, args);

			const { channelId, payload } = parsed;
			const content = typeof payload.content === "string" ? payload.content : "";
			if (!content || (Array.isArray(payload.stickers) && payload.stickers.length) || (Array.isArray(payload.uploads) && payload.uploads.length)) {
				return orig.apply(mod, args);
			}

			const US = getUserStore();
			const me = US && US.getCurrentUser && US.getCurrentUser();
			const uid = me && me.id;
			if (!uid) return orig.apply(mod, args);

			const norm = normalize(content, settings.normalizeWhitespace);
			if (!norm) return orig.apply(mod, args);

			const recent = recentOwnMessages(channelId, uid, settings.lookback);
			const dup = recent.some((m) => normalize(m.content || "", settings.normalizeWhitespace) === norm);
			if (!dup) return orig.apply(mod, args);

			// Discord's send pipeline expects sendMessage to return a Promise (it chains .then).
			// Returning undefined here caused: TypeError: Cannot read properties of undefined (reading 'then').
			return new Promise((resolve, reject) => {
				const runOrig = () => {
					let out;
					try {
						out = orig.apply(mod, args);
					} catch (e) {
						console.error("[DuplicateSendGuard] send after confirm", e);
						reject(e);
						return;
					}
					Promise.resolve(out).then(resolve, reject);
				};
				try {
					if (BdApi.UI && typeof BdApi.UI.showConfirmationModal === "function") {
						BdApi.UI.showConfirmationModal(
							"Duplicate message?",
							"This matches a recent message you already sent in this channel. Send anyway?",
							{
								confirmText: "Send anyway",
								cancelText: "Cancel",
								onConfirm: runOrig,
								onCancel: () => resolve(),
							},
						);
					} else {
						runOrig();
					}
				} catch (e) {
					console.error("[DuplicateSendGuard] confirmation modal", e);
					try {
						Promise.resolve(orig.apply(mod, args)).then(resolve, reject);
					} catch (e2) {
						reject(e2);
					}
				}
			});
		});
	}

	stop() {
		BdApi.Patcher.unpatchAll("DuplicateSendGuard");
	}

	getSettingsPanel() {
		const React = BdApi.React;
		const s = loadSettings();
		return React.createElement(
			"div",
			{ style: { padding: "8px 0" } },
			React.createElement(
				"label",
				{ style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 } },
				React.createElement("input", {
					type: "checkbox",
					defaultChecked: s.enabled,
					onChange: (e) => {
						BdApi.Data.save(SLUG, "enabled", e.target.checked);
						toast(e.target.checked ? "Guard enabled" : "Guard disabled", "info");
					},
				}),
				"Enable duplicate check",
			),
			React.createElement(
				"label",
				{ style: { display: "block", marginBottom: 8 } },
				"Lookback (own messages): ",
				React.createElement("input", {
					type: "number",
					min: 3,
					max: 50,
					defaultValue: s.lookback,
					style: { width: 64, marginLeft: 8 },
					onChange: (e) => {
						const n = parseInt(e.target.value, 10);
						if (!Number.isNaN(n)) BdApi.Data.save(SLUG, "lookback", n);
					},
				}),
			),
			React.createElement(
				"label",
				{ style: { display: "flex", alignItems: "center", gap: 8 } },
				React.createElement("input", {
					type: "checkbox",
					defaultChecked: s.normalizeWhitespace,
					onChange: (e) => {
						BdApi.Data.save(SLUG, "normalizeWhitespace", e.target.checked);
					},
				}),
				"Ignore extra spaces when comparing",
			),
			React.createElement(
				"p",
				{ style: { marginTop: 12, color: "var(--header-secondary)", fontSize: 12 } },
				"Only compares plain text content. Messages with attachments or stickers are not checked. Keep this file in your BetterDiscord plugins folder.",
			),
		);
	}
};

/**
 * @name Read Later
 * @author master3395
 * @version 1.2.22
 * @description Local-only queue of message links (Read later). Not channel tabs - manage from plugin settings or open jump links.
 * @invite nx9Kzrk
 * @donate https://www.paypal.com/paypalme/KimBS
 * @website https://newstargeted.com
 * @source https://github.com/master3395/BetterDiscord-Collections
 */

const DATA_KEY = "items";
const SLUG = "ReadLater";
/** Saved queue list page size (overlay, modal, settings). Clamped 1â€“50; default 10. */
const KEY_QUEUE_PAGE_SIZE = "queuePageSize";
/** 0â€“100: 100 = fully opaque queue window & dim layer (0% transparent); 0 = most see-through. */
const KEY_OVERLAY_BACKDROP_OPACITY = "overlayBackdropOpacityPct";
/** Saved as `{ code, ctrlKey, altKey, shiftKey, metaKey }` â€” see `loadKeyShortcut`. */
const KEY_SHORTCUT_OPEN_QUEUE = "shortcutOpenQueue";
const KEY_SHORTCUT_HOVER_SAVE = "shortcutHoverSave";

let _lastPointerClientX = 0;
let _lastPointerClientY = 0;
let _readLaterMouseMoveHandler = null;
let _readLaterGlobalKeyHandler = null;

function getOverlayBackdropOpacityPct() {
	try {
		const v = Number(BdApi.Data.load(SLUG, KEY_OVERLAY_BACKDROP_OPACITY));
		if (Number.isFinite(v)) return Math.min(100, Math.max(0, Math.round(v)));
	} catch (_e) {}
	return 100;
}

function saveOverlayBackdropOpacityPct(pct) {
	try {
		BdApi.Data.save(SLUG, KEY_OVERLAY_BACKDROP_OPACITY, Math.min(100, Math.max(0, Math.round(pct))));
	} catch (_e) {}
}

/** 0â€“1 strength from slider (100 = solid / max dim). */
function getQueueUiOpacityFactor() {
	return Math.min(1, Math.max(0, getOverlayBackdropOpacityPct() / 100));
}

/** @returns {{ code: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean } | null} */
function loadKeyShortcut(dataKey) {
	try {
		const o = BdApi.Data.load(SLUG, dataKey);
		if (o && typeof o === "object" && typeof o.code === "string" && o.code.length) return o;
	} catch (_e) {}
	return null;
}

function saveKeyShortcut(dataKey, obj) {
	try {
		if (!obj || typeof obj.code !== "string") BdApi.Data.save(SLUG, dataKey, null);
		else
			BdApi.Data.save(SLUG, dataKey, {
				code: obj.code,
				ctrlKey: !!obj.ctrlKey,
				altKey: !!obj.altKey,
				shiftKey: !!obj.shiftKey,
				metaKey: !!obj.metaKey,
			});
	} catch (_e) {}
}

function formatKeyShortcut(s) {
	if (!s || typeof s.code !== "string") return "â€” (not set)";
	const parts = [];
	if (s.ctrlKey) parts.push("Ctrl");
	if (s.altKey) parts.push("Alt");
	if (s.shiftKey) parts.push("Shift");
	if (s.metaKey) parts.push("Meta");
	parts.push(s.code.replace(/^Key/i, ""));
	return parts.join("+");
}

function eventMatchesKeyShortcut(e, s) {
	if (!s || typeof s.code !== "string") return false;
	if (e.code !== s.code) return false;
	if (!!e.ctrlKey !== !!s.ctrlKey) return false;
	if (!!e.altKey !== !!s.altKey) return false;
	if (!!e.shiftKey !== !!s.shiftKey) return false;
	if (!!e.metaKey !== !!s.metaKey) return false;
	return true;
}

function isTypingContext(target) {
	if (!target || typeof target.closest !== "function") return false;
	return !!target.closest(
		'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), [contenteditable="true"], [contenteditable=""], [role="textbox"]',
	);
}

function getMessageStore() {
	try {
		const S = BdApi.Webpack?.getStore?.("MessageStore");
		if (S && typeof S.getMessage === "function") return S;
	} catch (_e) {}
	return null;
}

/**
 * Resolve channel/message ids from a message row id (Discord uses `chat-messages-{channelId}-{messageId}` etc.).
 * @returns {{ channelId: string, messageId: string } | null}
 */
function parseMessageDomIds(el) {
	if (!el || typeof el.closest !== "function") return null;
	const hit = el.closest("[id^='chat-messages-'], [id^='message-content-']");
	const id = hit && hit.id;
	if (!id || typeof id !== "string") return null;
	let m = id.match(/^chat-messages-(\d+)-(\d+)$/);
	if (m) return { channelId: m[1], messageId: m[2] };
	m = id.match(/^message-content-(\d+)-(\d+)$/);
	if (m) return { channelId: m[1], messageId: m[2] };
	return null;
}

function tryAddMessageUnderPointer() {
	const x = _lastPointerClientX;
	const y = _lastPointerClientY;
	let el = null;
	try {
		el = document.elementFromPoint(x, y);
	} catch (_e) {}
	if (!el) {
		toast("Move the mouse over a message, then press the shortcut.", "info");
		return;
	}
	const ids = parseMessageDomIds(el);
	const MS = getMessageStore();
	const CH = getChannelStore();
	if (ids) {
		const message = MS?.getMessage?.(ids.channelId, ids.messageId);
		const channel = CH?.getChannel?.(ids.channelId);
		if (message?.id && channel?.id) {
			addItem(message, channel);
			return;
		}
	}
	const fiberHit = tryMessageFromReactFiber(el);
	if (fiberHit?.message?.id && fiberHit?.channel?.id) {
		addItem(fiberHit.message, fiberHit.channel);
		return;
	}
	toast("No message under the pointer â€” hover the message line (not the server list) and try again.", "warning");
}

function tryMessageFromReactFiber(startEl) {
	try {
		const RU = BdApi.ReactUtils;
		const U = BdApi.Utils;
		if (!RU?.getInternalInstance || !U?.findInTree || !startEl) return null;
		const walkable = ["child", "memoizedProps", "sibling", "return"];
		let el = startEl;
		for (let depth = 0; depth < 48 && el; depth++) {
			const inst = RU.getInternalInstance(el);
			if (inst) {
				const hit = U.findInTree(
					inst,
					(m) =>
						m &&
						m.message &&
						typeof m.message.id === "string" &&
						(m.channel?.id || typeof m.message.channel_id === "string"),
					{ walkable },
				);
				if (hit?.message?.id) {
					const CH2 = getChannelStore();
					const channel = hit.channel?.id ? hit.channel : CH2?.getChannel?.(hit.message.channel_id);
					if (channel?.id) return { message: hit.message, channel };
				}
			}
			el = el.parentElement;
		}
	} catch (_e) {}
	return null;
}

function startReadLaterGlobalShortcuts() {
	stopReadLaterGlobalShortcuts();
	try {
		_readLaterMouseMoveHandler = (e) => {
			try {
				_lastPointerClientX = e.clientX;
				_lastPointerClientY = e.clientY;
			} catch (_e) {}
		};
		document.addEventListener("mousemove", _readLaterMouseMoveHandler, { passive: true });
		_readLaterGlobalKeyHandler = (e) => {
			try {
				if (isTypingContext(e.target)) return;
				const openK = loadKeyShortcut(KEY_SHORTCUT_OPEN_QUEUE);
				const saveK = loadKeyShortcut(KEY_SHORTCUT_HOVER_SAVE);
				if (openK && eventMatchesKeyShortcut(e, openK)) {
					e.preventDefault();
					e.stopImmediatePropagation?.();
					e.stopPropagation();
					openReadLaterModal();
					return;
				}
				if (saveK && eventMatchesKeyShortcut(e, saveK)) {
					e.preventDefault();
					e.stopImmediatePropagation?.();
					e.stopPropagation();
					tryAddMessageUnderPointer();
				}
			} catch (err) {
				console.error("[ReadLater] global shortcut", err);
			}
		};
		document.addEventListener("keydown", _readLaterGlobalKeyHandler, true);
	} catch (e) {
		console.warn("[ReadLater] global shortcuts:", e);
	}
}

function stopReadLaterGlobalShortcuts() {
	if (_readLaterMouseMoveHandler) {
		try {
			document.removeEventListener("mousemove", _readLaterMouseMoveHandler, { passive: true });
		} catch (_e) {}
		_readLaterMouseMoveHandler = null;
	}
	if (_readLaterGlobalKeyHandler) {
		try {
			document.removeEventListener("keydown", _readLaterGlobalKeyHandler, true);
		} catch (_e) {}
		_readLaterGlobalKeyHandler = null;
	}
}

/** @param {string} channelId @param {string} messageId @param {string | null} guildId */
function jumpUrl(channelId, messageId, guildId) {
	const g = guildId && String(guildId).length ? guildId : "@me";
	return `https://discord.com/channels/${g}/${channelId}/${messageId}`;
}

/** In-client route (Discord router), same shape as the web URL path. */
function jumpClientPath(channelId, messageId, guildId) {
	const g = guildId && String(guildId).length ? guildId : "@me";
	return `/channels/${g}/${channelId}/${messageId}`;
}

/**
 * Discord's internal `transitionTo` (History / navigation utils).
 * @returns {((path: string) => void) | null}
 */
function getHistoryTransitionTo() {
	if (typeof _historyTransitionTo === "function") return _historyTransitionTo;
	const W = BdApi.Webpack;
	if (!W?.getModule) return null;
	try {
		const mod = W.getModule(
			(m) =>
				m &&
				typeof m === "object" &&
				typeof m.transitionTo === "function" &&
				String(m.transitionTo).includes("Transitioning"),
			{ searchExports: true },
		);
		if (mod?.transitionTo) {
			_historyTransitionTo = mod.transitionTo;
			return _historyTransitionTo;
		}
	} catch (_e) {}
	try {
		const fn = W.getModule(
			(m) => typeof m === "function" && String(m).includes("transitionTo - Transitioning to"),
			{ searchExports: true },
		);
		if (typeof fn === "function") _historyTransitionTo = fn;
	} catch (_e) {}
	return _historyTransitionTo;
}

/**
 * @param {string} url https://discord.com/channels/...
 * @returns {{ guildId: string, channelId: string, messageId: string } | null}
 */
function parseDiscordJumpUrl(url) {
	if (!url || typeof url !== "string") return null;
	const m = url.trim().match(/discord\.com\/channels\/([^/]+)\/([^/]+)\/([^/?#]+)/i);
	if (!m) return null;
	return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

/**
 * Open a saved entry inside the Discord client when possible; otherwise open the HTTPS link.
 * @param { { channelId?: string, messageId?: string, guildId?: string | null, url?: string } } entry
 */
function openReadLaterEntry(entry) {
	try {
		if (!entry) return;
		let channelId = entry.channelId;
		let messageId = entry.messageId;
		let guildId = entry.guildId;
		if ((!channelId || !messageId) && entry.url) {
			const p = parseDiscordJumpUrl(entry.url);
			if (p) {
				guildId = p.guildId;
				channelId = p.channelId;
				messageId = p.messageId;
			}
		}
		if (!channelId || !messageId) {
			toast("This entry has no jump target.", "error");
			return;
		}
		const path = jumpClientPath(channelId, messageId, guildId);
		const tt = getHistoryTransitionTo();
		if (typeof tt === "function") {
			try {
				tt(path);
				return;
			} catch (e) {
				console.warn("[ReadLater] transitionTo failed, using browser", e);
			}
		}
		openEntryUrl(entry.url || jumpUrl(channelId, messageId, guildId));
	} catch (e) {
		console.error("[ReadLater] openReadLaterEntry", e);
		try {
			if (entry?.url) openEntryUrl(entry.url);
		} catch (_e2) {}
	}
}

function getQueuePageSize() {
	try {
		const n = Number(BdApi.Data.load(SLUG, KEY_QUEUE_PAGE_SIZE));
		if (Number.isFinite(n)) return Math.min(50, Math.max(1, Math.round(n)));
	} catch (_e) {}
	return 10;
}

function saveQueuePageSize(n) {
	try {
		const v = Math.round(Number(n));
		const clamped = Number.isFinite(v) ? Math.min(50, Math.max(1, v)) : 10;
		BdApi.Data.save(SLUG, KEY_QUEUE_PAGE_SIZE, clamped);
	} catch (_e) {}
}

function loadItems() {
	try {
		const raw = BdApi.Data.load(SLUG, DATA_KEY);
		return Array.isArray(raw) ? raw : [];
	} catch (_e) {
		return [];
	}
}

function saveItems(items) {
	try {
		BdApi.Data.save(SLUG, DATA_KEY, items);
		refreshGuildBarBadge();
	} catch (_e) {}
}

function toast(msg, type) {
	try {
		if (BdApi.UI && typeof BdApi.UI.showToast === "function") BdApi.UI.showToast(msg, { type: type || "info" });
	} catch (_e) {}
}

function addItem(message, channel) {
	try {
		if (!message || !channel || !message.id || !channel.id) return;
		const guildId = channel.guild_id || null;
		const label =
			(message.content && String(message.content).slice(0, 80)) ||
			`Message ${message.id}`;
		const entry = {
			id: `${channel.id}:${message.id}`,
			channelId: channel.id,
			messageId: message.id,
			guildId,
			label,
			authorDisplay: resolveAuthorDisplay(message),
			messagePostedAt: resolveMessagePostedIso(message),
			guildName: resolveGuildDisplayName(guildId, channel),
			addedAt: Date.now(),
			url: jumpUrl(channel.id, message.id, guildId),
		};
		const items = loadItems().filter((x) => x && x.id !== entry.id);
		items.unshift(entry);
		const max = Math.min(200, Math.max(10, Number(BdApi.Data.load(SLUG, "maxItems")) || 80));
		saveItems(items.slice(0, max));
		toast("Saved to Read later", "success");
	} catch (e) {
		console.error("[ReadLater]", e);
		toast("Could not save to queue", "error");
	}
}

/** Discord menu item ids often used as anchor (see e.g. Translator / BDFDB patterns). */
const COPY_ANCHOR_IDS = ["copy-text", "copy-link", "devmode-copy-id"];
const STYLE_ID = "ReadLater-styles";
/** Message right-click menus: BD ids (BDFDB also uses `message-actions`). */
const MESSAGE_MENU_IDS = ["message-context", "MESSAGE_CONTEXT_MENU", "message-actions"];
let _channelStore = null;
let _guildStore = null;

let _readLaterGuildBarMo = null;
let _readLaterGuildBarTimer = null;
let _readLaterGuildBarBtn = null;
let _readLaterGuildBarWrap = null;
let _readLaterGuildBarFrame = null;
let _useMessageMenuPatched = false;
/** @type {((path: string) => void) | null} */
let _historyTransitionTo = null;

function childrenToArray(children) {
	if (children == null) return [];
	const R = BdApi.React;
	if (R && R.Children && typeof R.Children.toArray === "function") {
		try {
			return R.Children.toArray(children);
		} catch (_e) {}
	}
	return Array.isArray(children) ? children : [children];
}

/**
 * Find a mutable sibling array + insert index (after copy/link), walking nested menu groups.
 * @returns { [import("react").ReactNode[] | null, number] | null }
 */
function nodeMatchesCopyAnchor(node) {
	if (!node || typeof node !== "object") return false;
	const id = node.props && node.props.id;
	if (typeof id === "string" && COPY_ANCHOR_IDS.includes(id)) return true;
	const label = node.props && node.props.label;
	if (typeof label === "string") {
		const t = label.trim();
		if (/^copy text$/i.test(t)) return true;
		if (/copy message link/i.test(t)) return true;
	}
	return false;
}

function nodeMatchesTranslate(node) {
	if (!node || typeof node !== "object") return false;
	const label = node.props && node.props.label;
	return typeof label === "string" && /translate/i.test(label.trim());
}

function findInsertionTarget(nodes) {
	const list = childrenToArray(nodes);
	for (let i = 0; i < list.length; i++) {
		const node = list[i];
		if (!node || typeof node !== "object") continue;
		if (nodeMatchesTranslate(node)) return [list, i + 1];
		if (nodeMatchesCopyAnchor(node)) return [list, i + 1];
		const deeper = node.props && node.props.children;
		const nested = findInsertionTarget(deeper);
		if (nested) return nested;
	}
	return null;
}

function getChannelStore() {
	if (_channelStore) return _channelStore;
	try {
		const W = BdApi.Webpack;
		if (W && typeof W.getStore === "function") {
			_channelStore = W.getStore("ChannelStore");
		}
	} catch (_e) {}
	return _channelStore;
}

function getGuildStore() {
	if (_guildStore) return _guildStore;
	try {
		const W = BdApi.Webpack;
		if (W && typeof W.getStore === "function") {
			_guildStore = W.getStore("GuildStore");
		}
	} catch (_e) {}
	return _guildStore;
}

/** Display name for message author (global name preferred). */
function resolveAuthorDisplay(message) {
	try {
		const a = message?.author;
		if (!a) return "";
		const g = a.globalName || a.global_name;
		const u = a.username || a.name;
		const s = String((g && String(g).trim()) || (u && String(u).trim()) || "").trim();
		return s || "Unknown";
	} catch (_e) {
		return "";
	}
}

/** Persistable ISO string for when the message was sent (best effort). */
function resolveMessagePostedIso(message) {
	try {
		const t = message?.timestamp;
		if (t == null) return null;
		if (typeof t === "string" && t.length) return t;
		if (t instanceof Date && !Number.isNaN(t.getTime())) return t.toISOString();
		if (typeof t === "number" && Number.isFinite(t)) return new Date(t).toISOString();
	} catch (_e) {}
	return null;
}

/** Guild / DM label for the list UI. */
function resolveGuildDisplayName(guildId, channel) {
	try {
		if (!guildId || guildId === "@me") {
			const n = channel?.name;
			if (typeof n === "string" && n.trim()) return n.trim();
			return "Direct messages";
		}
		const name = getGuildStore()?.getGuild?.(guildId)?.name;
		if (typeof name === "string" && name.trim()) return name.trim();
	} catch (_e) {}
	return "Server";
}

/** @param { { messagePostedAt?: string | null } } entry */
function formatEntryPostedDisplay(entry) {
	try {
		const iso = entry?.messagePostedAt;
		if (!iso || typeof iso !== "string") return "";
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return "";
		return d.toLocaleString();
	} catch (_e) {
		return "";
	}
}

/** One-line meta: author Â· posted time Â· server */
function formatEntryMetaLine(entry) {
	if (!entry) return "";
	const parts = [];
	const author = typeof entry.authorDisplay === "string" && entry.authorDisplay.trim() ? entry.authorDisplay.trim() : "";
	if (author) parts.push(author);
	const when = formatEntryPostedDisplay(entry);
	if (when) parts.push(when);
	const guild = typeof entry.guildName === "string" && entry.guildName.trim() ? entry.guildName.trim() : "";
	if (guild) parts.push(guild);
	return parts.join(" Â· ");
}

/**
 * BD ContextMenu.patch may call (menuElement, renderProps, instance) or only (returnValue, props)
 * like BDFDBâ€™s internal wiring â€” when `instance` is missing, message/channel are often on the second arg.
 */
function normalizeContextMenuPatchArgs(...args) {
	const tree = args[0];
	const renderProps = args[1];
	const instance = args[2];
	if (args.length <= 1) return { tree, renderProps, instance };
	const noInst = instance === undefined || instance === null;
	if (noInst && renderProps != null && typeof renderProps === "object") {
		return { tree, renderProps, instance: { props: renderProps } };
	}
	return { tree, renderProps, instance };
}

/**
 * Merge menu props from tree, renderProps, and instance (see normalizeContextMenuPatchArgs).
 */
function resolveContext(tree, renderProps, instance) {
	const fromRender = renderProps && typeof renderProps === "object" ? renderProps : {};
	const fromTree = tree?.props && typeof tree.props === "object" ? tree.props : {};
	const fromInst = instance?.props && typeof instance.props === "object" ? instance.props : {};
	const merged = { ...fromRender, ...fromTree, ...fromInst };
	let message = merged.message;
	if (!message?.id && merged.messageSnapshot) message = merged.messageSnapshot;
	if (!message?.id) return null;
	if (merged.channel && merged.channel.id) return { message, channel: merged.channel };
	const channelId =
		merged.channelId ||
		merged.channel?.id ||
		message.channel_id ||
		merged.target?.dataset?.listItemId?.split("_")?.pop();
	if (!channelId) return null;
	const channel = getChannelStore()?.getChannel?.(channelId);
	return channel && channel.id ? { message, channel } : null;
}

function openEntryUrl(url) {
	try {
		const { shell } = require("electron");
		shell.openExternal(url);
	} catch (_e) {
		window.open(url, "_blank");
	}
}

function getModalComponents() {
	try {
		const W = BdApi.Webpack;
		if (!W) return null;
		if (W.getByKeys) {
			const a = W.getByKeys("openModal", "ModalRoot", "ModalHeader", "ModalContent", "ModalCloseButton");
			if (a?.openModal && a.ModalRoot && a.ModalContent) return a;
			const b = W.getByKeys("openModal", "closeModal", "ModalRoot", "ModalHeader", "ModalContent");
			if (b?.openModal && b.ModalRoot && b.ModalContent) return b;
		}
		if (W.getModule) {
			const c = W.getModule((m) => m && typeof m.openModal === "function" && typeof m.closeModal === "function" && m.ModalRoot && m.ModalContent, {
				searchExports: true,
			});
			if (c) return c;
		}
	} catch (_e) {}
	return null;
}

function closeReadLaterOverlay() {
	const el = document.getElementById("lrlq-readlater-overlay");
	if (el) {
		try {
			el.remove();
		} catch (_e) {}
	}
}

function openReadLaterOverlay() {
	closeReadLaterOverlay();
	const mount = document.getElementById("app-mount");
	if (!mount) return;
	const root = document.createElement("div");
	root.id = "lrlq-readlater-overlay";
	root.innerHTML = "";
	const backdrop = document.createElement("div");
	backdrop.className = "lrlq-overlay-backdrop";
	const f = getQueueUiOpacityFactor();
	backdrop.style.background = `rgba(0,0,0,${(0.08 + f * 0.88).toFixed(3)})`;
	backdrop.addEventListener("click", closeReadLaterOverlay);
	const panel = document.createElement("div");
	panel.className = "lrlq-overlay-panel";
	panel.style.backgroundColor = "#1e1f22";
	panel.style.color = "#dbdee1";
	panel.style.opacity = "1";
	const head = document.createElement("div");
	head.className = "lrlq-overlay-head";
	const ht = document.createElement("span");
	ht.className = "lrlq-overlay-title";
	ht.textContent = "Read later";
	const xb = document.createElement("button");
	xb.type = "button";
	xb.className = "lrlq-overlay-x";
	xb.textContent = "Ã - ";
	xb.addEventListener("click", closeReadLaterOverlay);
	head.appendChild(ht);
	head.appendChild(xb);
	panel.appendChild(head);
	const body = document.createElement("div");
	body.className = "lrlq-overlay-body";
	const listHost = document.createElement("div");
	listHost.className = "lrlq-overlay-list";
	const pagerHost = document.createElement("div");
	pagerHost.className = "lrlq-overlay-pager";
	body.appendChild(listHost);
	body.appendChild(pagerHost);

	let currentPage = 0;

	function renderOverlayPage() {
		const all = loadItems();
		const pageSize = getQueuePageSize();
		listHost.innerHTML = "";
		pagerHost.innerHTML = "";
		if (!all.length) {
			const p = document.createElement("p");
			p.style.color = "var(--text-muted)";
			p.style.marginTop = "8px";
			p.textContent =
				"No saved messages yet. Use the message context menu, or set the \"save under mouse\" shortcut in plugin settings.";
			listHost.appendChild(p);
			return;
		}
		const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
		currentPage = Math.min(Math.max(0, currentPage), pageCount - 1);
		const start = currentPage * pageSize;
		const pageItems = all.slice(start, start + pageSize);
		for (const e of pageItems) {
			const row = document.createElement("div");
			row.className = "lrlq-overlay-row";
			const lab = document.createElement("div");
			lab.className = "lrlq-overlay-label";
			lab.textContent = e.label || e.url;
			const meta = document.createElement("div");
			meta.className = "lrlq-overlay-meta";
			meta.textContent = formatEntryMetaLine(e) || "";
			const u = document.createElement("div");
			u.className = "lrlq-overlay-url";
			u.textContent = e.url;
			const go = document.createElement("button");
			go.type = "button";
			go.className = "bd-button bd-button-filled bd-button-color-brand";
			go.textContent = "Jump";
			go.addEventListener("click", () => {
				openReadLaterEntry(e);
				closeReadLaterOverlay();
			});
			const rm = document.createElement("button");
			rm.type = "button";
			rm.className = "bd-button bd-button-filled bd-button-color-red";
			rm.textContent = "Remove";
			rm.addEventListener("click", () => {
				saveItems(all.filter((x) => x.id !== e.id));
				const next = loadItems();
				const pc = Math.max(1, Math.ceil(next.length / pageSize));
				if (currentPage >= pc) currentPage = Math.max(0, pc - 1);
				renderOverlayPage();
			});
			row.appendChild(lab);
			row.appendChild(meta);
			row.appendChild(u);
			row.appendChild(go);
			row.appendChild(rm);
			listHost.appendChild(row);
		}
		const info = document.createElement("span");
		info.className = "lrlq-overlay-pager-info";
		info.textContent = `Page ${currentPage + 1} of ${pageCount} (${all.length} saved)`;
		const prev = document.createElement("button");
		prev.type = "button";
		prev.className = "bd-button bd-button-filled bd-button-color-primary";
		prev.textContent = "Previous";
		prev.disabled = currentPage <= 0;
		prev.addEventListener("click", () => {
			if (currentPage > 0) {
				currentPage--;
				renderOverlayPage();
			}
		});
		const next = document.createElement("button");
		next.type = "button";
		next.className = "bd-button bd-button-filled bd-button-color-primary";
		next.textContent = "Next";
		next.disabled = currentPage >= pageCount - 1;
		next.addEventListener("click", () => {
			if (currentPage < pageCount - 1) {
				currentPage++;
				renderOverlayPage();
			}
		});
		pagerHost.appendChild(prev);
		pagerHost.appendChild(info);
		pagerHost.appendChild(next);
	}

	renderOverlayPage();
	panel.appendChild(body);
	root.appendChild(backdrop);
	root.appendChild(panel);
	mount.appendChild(root);
}

/** Cached modal queue body (pagination); same React across BD. */
let _ReadLaterModalQueueCmp = null;

/**
 * @param {typeof import("react")} React
 */
function getReadLaterModalQueueClass(React) {
	if (_ReadLaterModalQueueCmp) return _ReadLaterModalQueueCmp;
	class ReadLaterModalQueueBody extends React.Component {
		constructor(props) {
			super(props);
			this.state = { page: 0 };
		}
		componentDidUpdate() {
			const { items } = this.props;
			if (!items || !items.length) return;
			const pageSize = getQueuePageSize();
			const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
			const maxP = pageCount - 1;
			if (this.state.page > maxP) this.setState({ page: maxP });
		}
		render() {
			const { items, modalProps } = this.props;
			const pageSize = getQueuePageSize();
			if (!items.length) {
				return React.createElement(
					"p",
					{ style: { color: "#b5bac1", marginTop: 8, fontSize: 14, lineHeight: 1.45 } },
					"No saved messages yet. Use the context menu on a message, or the save-under-mouse shortcut in plugin settings.",
				);
			}
			const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
			const pageSafe = Math.min(this.state.page, pageCount - 1);
			const start = pageSafe * pageSize;
			const slice = items.slice(start, start + pageSize);
			const rowStyle = {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "8px 0",
				borderBottom: "1px solid #3f4147",
			};
			const rows = slice.map((e) => {
				const metaLine = formatEntryMetaLine(e);
				return React.createElement(
					"div",
					{ key: e.id, style: rowStyle },
					React.createElement(
						"div",
						{ style: { flex: 1, minWidth: 0 } },
						React.createElement("div", { style: { fontWeight: 600, fontSize: 14, color: "#f2f3f5" } }, e.label),
						metaLine
							? React.createElement(
									"div",
									{ style: { fontSize: 11, color: "#949ba4", marginTop: 4, lineHeight: 1.35 } },
									metaLine,
								)
							: null,
						React.createElement(
							"div",
							{ style: { fontSize: 12, color: "#949ba4", wordBreak: "break-all", marginTop: 4 } },
							e.url,
						),
					),
					React.createElement(
						"button",
						{
							type: "button",
							className: "bd-button bd-button-filled bd-button-color-brand",
							onClick: () => {
								openReadLaterEntry(e);
								modalProps.onClose?.();
							},
						},
						"Jump to message",
					),
				);
			});
			const pagerStyle = {
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				justifyContent: "center",
				gap: 8,
				marginTop: 12,
				paddingTop: 10,
				borderTop: "1px solid #3f4147",
			};
			const info = React.createElement(
				"span",
				{ style: { fontSize: 12, color: "#949ba4" } },
				`Page ${pageSafe + 1} of ${pageCount} (${items.length} saved)`,
			);
			const prev = React.createElement(
				"button",
				{
					type: "button",
					className: "bd-button bd-button-filled bd-button-color-primary",
					disabled: pageSafe <= 0,
					onClick: () => this.setState({ page: Math.max(0, pageSafe - 1) }),
				},
				"Previous",
			);
			const next = React.createElement(
				"button",
				{
					type: "button",
					className: "bd-button bd-button-filled bd-button-color-primary",
					disabled: pageSafe >= pageCount - 1,
					onClick: () => this.setState({ page: Math.min(pageCount - 1, pageSafe + 1) }),
				},
				"Next",
			);
			const pager = React.createElement("div", { style: pagerStyle }, prev, info, next);
			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 10, marginTop: 4 } },
				rows,
				pager,
			);
		}
	}
	_ReadLaterModalQueueCmp = ReadLaterModalQueueBody;
	return ReadLaterModalQueueBody;
}

/**
 * @param {unknown} modalProps Discord passes into the modal render callback
 */
function buildReadLaterModalTree(React, M, items, modalProps) {
	const MH = M.ModalHeader;
	const Close = M.ModalCloseButton;
	const headerInner = React.createElement(
		"div",
		{
			style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				width: "100%",
				gap: 12,
			},
		},
		React.createElement("span", null, "Read later"),
		Close ? React.createElement(Close, { onClick: modalProps.onClose }) : null,
	);
	const opaqueHeaderStyle = {
		backgroundColor: "#1e1f22",
		color: "#f2f3f5",
		borderBottom: "1px solid #3f4147",
		padding: "12px 16px",
	};
	const header = MH
		? React.createElement(MH, null, React.createElement("div", { className: "lrlq-readlater-modal-headfill", style: opaqueHeaderStyle }, headerInner))
		: React.createElement(
				"div",
				{ style: { padding: "16px 16px 0", ...opaqueHeaderStyle } },
				headerInner,
			);
	const innerShellStyle = {
		backgroundColor: "#1e1f22",
		color: "#dbdee1",
		padding: "12px 16px 20px",
		minHeight: "140px",
		opacity: 1,
	};
	let body;
	if (!items.length) {
		body = React.createElement(
			"p",
			{ style: { color: "#b5bac1", marginTop: 8, fontSize: 14, lineHeight: 1.45 } },
			"No saved messages yet. Use the context menu on a message, or the save-under-mouse shortcut in plugin settings.",
		);
	} else {
		const QueueBody = getReadLaterModalQueueClass(React);
		body = React.createElement(QueueBody, { items, modalProps });
	}
	const contentShell = React.createElement("div", { className: "lrlq-readlater-modal-inner", style: innerShellStyle }, body);
	const modalContent = React.createElement(
		M.ModalContent,
		{
			className: "lrlq-readlater-modalbody",
			style: {
				backgroundColor: "#1e1f22",
				color: "#dbdee1",
				opacity: 1,
			},
		},
		contentShell,
	);
	return React.createElement(M.ModalRoot, modalProps, header, modalContent);
}

function openReadLaterModal() {
	try {
		closeReadLaterOverlay();
		const React = BdApi.React;
		const M = getModalComponents();
		const items = loadItems();
		if (!M?.openModal || !M.ModalRoot || !M.ModalContent) {
			openReadLaterOverlay();
			return;
		}
		M.openModal((modalProps) => buildReadLaterModalTree(React, M, items, modalProps));
	} catch (e) {
		console.error("[ReadLater] openReadLaterModal", e);
		try {
			openReadLaterOverlay();
		} catch (_e2) {}
	}
}

/**
 * Inject into message menu tree (BDFDB `useMessageMenu` stub returns menu root as 2nd arg / return value).
 * @param {unknown} menuRoot React element, instance-like node, or flat item array
 */
function injectReadLaterIntoUseMessageMenu(menuRoot, message, channel) {
	if (!menuRoot || !message?.id || !channel?.id) return;
	try {
		const BB = window.BDFDB;
		const MenuItem = BB?.LibraryComponents?.MenuItems?.MenuItem;
		if (BB?.ContextMenuUtils?.findItem && BB?.ContextMenuUtils?.createItem && MenuItem) {
			const wantId = BB.ContextMenuUtils.createItemId("ReadLater", "read-later");
			try {
				if (BB.ReactUtils?.findChild?.(menuRoot, { props: [["id", wantId]] })) return;
			} catch (_e) {}
			const anchorIdGroups = [
				["copy-text", "copy-link", "devmode-copy-id", "copy-native-link"],
				["edit", "reply", "forward"],
				["pin", "unpin"],
			];
			for (const ids of anchorIdGroups) {
				let [ch, idx] = BB.ContextMenuUtils.findItem(menuRoot, { id: ids });
				if (idx == -1 || !Array.isArray(ch)) [ch, idx] = BB.ContextMenuUtils.findItem(menuRoot, { id: ids, group: true });
				if (idx != -1 && Array.isArray(ch)) {
					ch.splice(
						idx + 1,
						0,
						BB.ContextMenuUtils.createItem(MenuItem, {
							label: "Read later",
							id: wantId,
							action: () => addItem(message, channel),
						}),
					);
					return;
				}
			}
		}
	} catch (e) {
		console.error("[ReadLater] BDFDB menu inject", e);
	}
	const { ContextMenu } = BdApi;
	if (!ContextMenu?.buildItem) return;
	const item = ContextMenu.buildItem({
		label: "Read later",
		id: "local-read-later-queue-add",
		action: () => addItem(message, channel),
	});
	let roots;
	if (Array.isArray(menuRoot)) {
		roots = menuRoot;
	} else if (menuRoot.props) {
		roots = childrenToArray(menuRoot.props.children);
		menuRoot.props.children = roots;
	} else return;
	if (roots.some((x) => x?.props?.id === "local-read-later-queue-add")) return;
	if (roots.some((x) => typeof x?.props?.label === "string" && /^Read later$/i.test(String(x.props.label).trim()))) return;
	const hit = findInsertionTarget(roots);
	if (hit) {
		const [arr, at] = hit;
		arr.splice(Math.min(at, arr.length), 0, item);
	} else {
		roots.splice(1, 0, item);
	}
}

function getMessageToolbarUtils() {
	const W = BdApi.Webpack;
	if (!W?.getModule) return null;
	const pick = (x) => {
		if (!x || typeof x !== "object") return null;
		if (typeof x.useMessageMenu === "function") return x;
		if (typeof x.default?.useMessageMenu === "function") return x.default;
		if (typeof x.Z?.useMessageMenu === "function") return x.Z;
		for (const k of Object.keys(x)) {
			if (typeof x[k]?.useMessageMenu === "function") return x[k];
		}
		return null;
	};
	try {
		const byKeys = W.getByKeys?.("useMessageMenu", "useThreadMenu");
		const p = pick(byKeys);
		if (p) return p;
	} catch (_e) {}
	try {
		const m = W.getModule((x) => !!pick(x), { searchExports: true });
		const p = pick(m);
		if (p) return p;
	} catch (_e) {}
	return null;
}

/**
 * Same hook as DevilBro Translator: `MessageToolbarUtils.useMessageMenu`.
 * Prefer `window.BDFDB.LibraryModules.MessageToolbarUtils` when ZeresPluginLibrary is loaded (matches Translatorâ€™s module reference).
 */
function patchUseMessageMenuOnceOn(target) {
	const { Patcher } = BdApi;
	if (!Patcher?.after || !target || typeof target.useMessageMenu !== "function") return false;
	Patcher.after("ReadLater", target, "useMessageMenu", (_, args, ret) => {
		try {
			const a0 = args?.[0];
			const a1 = args?.[1];
			if (!a0 || typeof a0 !== "object") return;
			let message = a0.message;
			let channel = a0.channel;
			if (!message?.id && a0.messageSnapshot) message = a0.messageSnapshot;
			if ((!message?.id || !channel?.id) && a1 && typeof a1 === "object") {
				if (!message?.id) {
					if (a1.message?.id) message = a1.message;
					else if (a1.messageSnapshot?.id) message = a1.messageSnapshot;
					else if (a1.props?.message?.id) message = a1.props.message;
					else if (a1.props?.messageSnapshot?.id) message = a1.props.messageSnapshot;
				}
				if (!channel?.id) {
					if (a1.channel?.id) channel = a1.channel;
					else if (a1.props?.channel?.id) channel = a1.props.channel;
				}
			}
			if (!message?.id || !channel?.id) return;
			let menuRoot = ret != null ? ret : a1;
			if (menuRoot && typeof menuRoot === "object" && !Array.isArray(menuRoot) && !menuRoot.props && a1?.props?.children != null) {
				menuRoot = a1;
			}
			injectReadLaterIntoUseMessageMenu(menuRoot, message, channel);
		} catch (e) {
			console.error("[ReadLater] useMessageMenu", e);
		}
	});
	return true;
}

function patchUseMessageMenu() {
	if (_useMessageMenuPatched) return;
	const tryNow = () => {
		if (_useMessageMenuPatched) return true;
		try {
			const B = window.BDFDB?.LibraryModules?.MessageToolbarUtils;
			if (B && patchUseMessageMenuOnceOn(B)) {
				_useMessageMenuPatched = true;
				return true;
			}
		} catch (_e) {}
		const MTU = getMessageToolbarUtils();
		if (MTU && patchUseMessageMenuOnceOn(MTU)) {
			_useMessageMenuPatched = true;
			return true;
		}
		return false;
	};
	if (tryNow()) return;
	setTimeout(() => {
		if (tryNow()) return;
		setTimeout(() => {
			tryNow();
		}, 5000);
	}, 2000);
	if (!_useMessageMenuPatched) console.warn("[ReadLater] MessageToolbarUtils.useMessageMenu not yet found; will retry (Read later in message menu).");
}

/** Extra safety patch: some builds skip `message-context` but still expose message-ish navIds. */
function patchAnyMessageContextMenu() {
	const { ContextMenu } = BdApi;
	if (!ContextMenu || typeof ContextMenu.patch !== "function") return null;
	const onAny = (...patchArgs) => {
		try {
			const { tree, renderProps, instance } = normalizeContextMenuPatchArgs(...patchArgs);
			const ctx = resolveContext(tree, renderProps, instance);
			if (!ctx) return;
			injectReadLaterIntoUseMessageMenu(tree, ctx.message, ctx.channel);
		} catch (e) {
			console.error("[ReadLater] any-context", e);
		}
	};
	try {
		return ContextMenu.patch(/message|context/i, onAny);
	} catch (_e) {
		return null;
	}
}

/** DevilBro ReadAllNotificationsButton renders a literal "read all" pill in the server column â€” we sibling-match that row. */
function findReadAllTextElement() {
	const root = document.getElementById("app-mount");
	if (!root || typeof document.createTreeWalker !== "function") return null;
	const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
	let n;
	while ((n = w.nextNode())) {
		const t = n.nodeValue && n.nodeValue.trim().toLowerCase();
		if (t === "read all") return n.parentElement;
	}
	return null;
}

function refreshGuildBarBadge() {
	if (!_readLaterGuildBarBtn || !_readLaterGuildBarBtn.isConnected) return;
	const n = loadItems().length;
	if (n > 0) _readLaterGuildBarBtn.setAttribute("data-count", n > 99 ? "99+" : String(n));
	else _readLaterGuildBarBtn.removeAttribute("data-count");
}

/**
 * Horizontal flex strip that contains Read All. Walks up and picks the **outermost** row under width cap
 * (toolbar row), so we insert after that whole row â€” new line below read all, not inside it.
 */
function findReadAllStripRow(frame) {
	if (!frame) return null;
	const hits = [];
	let p = frame.parentElement;
	const cap = typeof window !== "undefined" && window.innerWidth ? Math.min(560, window.innerWidth * 0.5) : 560;
	while (p) {
		try {
			const st = window.getComputedStyle(p);
			const isRow = st.display.includes("flex") && (st.flexDirection === "row" || st.flexDirection === "row-reverse");
			if (isRow && p.contains(frame)) {
				const w = p.clientWidth || 0;
				if (w > 0 && w <= cap) hits.push(p);
			}
		} catch (_e) {}
		p = p.parentElement;
	}
	if (!hits.length) return null;
	return hits[hits.length - 1];
}

function onOpenLaterBarClick(ev) {
	try {
		openReadLaterModal();
	} catch (e) {
		console.error("[ReadLater] open later click", e);
		try {
			openReadLaterOverlay();
		} catch (_e2) {}
	}
}

/** `ref` is the node to pass as second arg to `parent.insertBefore(node, ref)`. */
function adjustGuildBarInsertRef(ref, existingWrap) {
	let r = ref;
	if (existingWrap && r === existingWrap) r = existingWrap.nextSibling;
	if (r && r.classList && r.classList.contains("lrlq-readlater-wrap")) r = r.nextSibling;
	return r;
}

function mountGuildBarReadLater() {
	const readAllEl = findReadAllTextElement();
	if (!readAllEl) return;
	let outer = readAllEl;
	let x = readAllEl;
	while (x) {
		const cn = x.className;
		if (typeof cn === "string" && cn.toLowerCase().includes("readall")) outer = x;
		x = x.parentElement;
	}
	const frame = outer;
	const stripRow = findReadAllStripRow(frame);
	let insertParent = null;
	let beforeRef = null;
	if (stripRow?.parentElement) {
		insertParent = stripRow.parentElement;
		beforeRef = stripRow.nextSibling;
	} else if (frame.parentElement) {
		insertParent = frame.parentElement;
		beforeRef = frame.nextSibling;
	}
	if (!insertParent) return;
	const WRAP_SEL = ".lrlq-readlater-wrap[data-lrlq-readlater-bar]";
	try {
		document.querySelectorAll(WRAP_SEL).forEach((el) => {
			if (el.parentElement !== insertParent) {
				try {
					el.remove();
				} catch (_e) {}
			}
		});
	} catch (_e) {}
	let existing = Array.from(insertParent.children).find(
		(c) => c && c.classList && c.classList.contains("lrlq-readlater-wrap") && c.getAttribute("data-lrlq-readlater-bar") === "1",
	);
	const dupes = Array.from(insertParent.querySelectorAll(WRAP_SEL)).filter((el) => el.parentElement === insertParent);
	if (dupes.length > 1) {
		for (let i = 1; i < dupes.length; i++) {
			try {
				dupes[i].remove();
			} catch (_e) {}
		}
		existing = Array.from(insertParent.children).find(
			(c) => c && c.classList && c.classList.contains("lrlq-readlater-wrap") && c.getAttribute("data-lrlq-readlater-bar") === "1",
		);
	}
	beforeRef = adjustGuildBarInsertRef(beforeRef, existing);
	if (existing) {
		try {
			insertParent.insertBefore(existing, beforeRef);
		} catch (_e) {}
		_readLaterGuildBarFrame = frame;
		_readLaterGuildBarWrap = existing;
		_readLaterGuildBarBtn = existing.querySelector(".lrlq-readlater-guildbar");
		if (_readLaterGuildBarBtn) {
			_readLaterGuildBarBtn.onclick = onOpenLaterBarClick;
			applyReadLaterGuildBarVisibleStyles(_readLaterGuildBarBtn, existing);
			refreshGuildBarBadge();
			return;
		}
		try {
			existing.remove();
		} catch (_e) {}
	}
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "lrlq-readlater-guildbar";
	const lbl = document.createElement("span");
	lbl.className = "lrlq-readlater-guildbar-label";
	lbl.textContent = "Read later";
	btn.appendChild(lbl);
	btn.title = "open later";
	btn.setAttribute("aria-label", "Read later");
	btn.onclick = onOpenLaterBarClick;
	const wrap = document.createElement("div");
	wrap.className = "lrlq-readlater-wrap";
	wrap.setAttribute("data-lrlq-readlater-bar", "1");
	wrap.appendChild(btn);
	_readLaterGuildBarFrame = frame;
	insertParent.insertBefore(wrap, beforeRef);
	_readLaterGuildBarWrap = wrap;
	_readLaterGuildBarBtn = btn;
	applyReadLaterGuildBarVisibleStyles(btn, wrap);
	refreshGuildBarBadge();
}

/** Inline fallbacks so the control stays visible even when theme vars or parent flex clips CSS-only rules. */
function applyReadLaterGuildBarVisibleStyles(btn, wrapEl) {
	try {
		if (wrapEl && wrapEl.style) {
			wrapEl.style.display = "block";
			wrapEl.style.visibility = "visible";
			wrapEl.style.opacity = "1";
			wrapEl.style.margin = "6px 4px";
			wrapEl.style.padding = "2px 0";
		}
		if (btn && btn.style) {
			btn.style.display = "flex";
			btn.style.visibility = "visible";
			btn.style.opacity = "1";
			btn.style.minHeight = "28px";
			btn.style.minWidth = "56px";
			btn.style.width = "100%";
			btn.style.boxSizing = "border-box";
			btn.style.alignItems = "center";
			btn.style.justifyContent = "center";
			btn.style.borderRadius = "4px";
			btn.style.border = "none";
			btn.style.cursor = "pointer";
			btn.style.fontWeight = "600";
			btn.style.fontSize = "12px";
			btn.style.lineHeight = "1.35";
			btn.style.setProperty("color", "#f2f3f5", "important");
			btn.style.setProperty("background-color", "#5865f2", "important");
		}
	} catch (_e) {}
}

function startGuildBarReadLaterObserver() {
	stopGuildBarReadLaterObserver();
	const schedule = () => {
		try {
			clearTimeout(_readLaterGuildBarTimer);
		} catch (_e) {}
		_readLaterGuildBarTimer = setTimeout(() => {
			try {
				mountGuildBarReadLater();
			} catch (e) {
				console.error("[ReadLater] guild bar mount", e);
			}
		}, 120);
	};
	schedule();
	const mount = document.getElementById("app-mount");
	if (!mount) return;
	try {
		_readLaterGuildBarMo = new MutationObserver(schedule);
		_readLaterGuildBarMo.observe(mount, { childList: true, subtree: true });
	} catch (e) {
		console.warn("[ReadLater] guild bar observer:", e);
	}
}

function stopGuildBarReadLaterObserver() {
	try {
		clearTimeout(_readLaterGuildBarTimer);
	} catch (_e) {}
	_readLaterGuildBarTimer = null;
	if (_readLaterGuildBarMo) {
		try {
			_readLaterGuildBarMo.disconnect();
		} catch (_e) {}
		_readLaterGuildBarMo = null;
	}
	if (_readLaterGuildBarWrap) {
		try {
			_readLaterGuildBarWrap.remove();
		} catch (_e) {}
		_readLaterGuildBarWrap = null;
	} else if (_readLaterGuildBarBtn) {
		try {
			_readLaterGuildBarBtn.remove();
		} catch (_e) {}
	}
	_readLaterGuildBarFrame = null;
	_readLaterGuildBarBtn = null;
}

module.exports = class ReadLater {
	constructor(meta) {
		this.meta = meta;
		this._unpatches = [];
	}

	start() {
		try {
			if (BdApi.DOM && typeof BdApi.DOM.addStyle === "function") {
				BdApi.DOM.addStyle(
					STYLE_ID,
					`#app-mount .lrlq-readlater-wrap[data-lrlq-readlater-bar]{display:block!important;box-sizing:border-box!important;width:100%!important;max-width:100%!important;margin:4px 0!important;padding:0 4px!important;overflow:visible!important;position:relative!important;z-index:10!important;flex:none!important;visibility:visible!important;opacity:1!important;}
#app-mount .lrlq-readlater-guildbar{display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-height:28px!important;height:auto!important;border-radius:4px!important;font-size:12px!important;line-height:1.35!important;white-space:nowrap!important;text-align:center!important;cursor:pointer!important;padding:6px 8px!important;margin:0!important;font-weight:600!important;visibility:visible!important;overflow:visible!important;text-indent:0!important;letter-spacing:normal!important;background:var(--brand-500, #5865f2)!important;color:var(--white-500, #f2f3f5)!important;-webkit-text-fill-color:var(--white-500, #f2f3f5)!important;opacity:1!important;pointer-events:auto!important;position:relative!important;border:none!important;}
#app-mount .lrlq-readlater-guildbar .lrlq-readlater-guildbar-label{display:inline-block!important;font-size:12px!important;font-weight:600!important;line-height:1.35!important;color:inherit!important;-webkit-text-fill-color:inherit!important;white-space:nowrap!important;pointer-events:none!important;}
#app-mount .lrlq-readlater-guildbar:hover{filter:brightness(1.12)!important;}
#app-mount .lrlq-readlater-guildbar[data-count]::after{content:" (" attr(data-count) ")";margin-left:4px;font-size:10px;font-weight:700;color:var(--brand-500);}
.lrlq-readlater-modalbody,.lrlq-readlater-modal-inner,.lrlq-readlater-modal-headfill{background-color:#1e1f22!important;background:#1e1f22!important;opacity:1!important;color:#dbdee1!important;}
.lrlq-readlater-modal-inner .bd-button,.lrlq-readlater-modal-inner button{opacity:1!important;}
#lrlq-readlater-overlay{position:fixed;inset:0;z-index:100000;pointer-events:auto;}
.lrlq-overlay-backdrop{position:absolute;inset:0;}
.lrlq-overlay-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,92vw);max-height:min(70vh,560px);display:flex;flex-direction:column;background:var(--background-primary);border-radius:8px;box-shadow:var(--elevation-high);border:1px solid var(--background-modifier-accent);}
.lrlq-overlay-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--background-modifier-accent);font-weight:700;text-transform:lowercase;}
.lrlq-overlay-x{background:transparent;border:none;color:var(--interactive-normal);font-size:22px;line-height:1;cursor:pointer;padding:0 4px;}
.lrlq-overlay-x:hover{color:var(--interactive-active);}
.lrlq-overlay-body{padding:12px 14px;overflow-y:auto;}
.lrlq-overlay-list{min-height:0;}
.lrlq-overlay-pager{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--background-modifier-accent);}
.lrlq-overlay-pager-info{font-size:12px;color:var(--text-muted);}
.lrlq-overlay-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--background-modifier-accent);}
.lrlq-overlay-label{flex:1 1 100%;font-weight:600;font-size:14px;}
.lrlq-overlay-meta{flex:1 1 100%;font-size:11px;color:var(--text-muted);margin-top:2px;line-height:1.35;}
.lrlq-overlay-url{flex:1 1 100%;font-size:12px;color:var(--text-muted);word-break:break-all;}`,
				);
			}
		} catch (_e) {}

		const { ContextMenu } = BdApi;
		if (!ContextMenu || typeof ContextMenu.patch !== "function") {
			console.warn("[ReadLater] ContextMenu.patch unavailable.");
		} else {
			const onMessageMenu = (...patchArgs) => {
				try {
					const { tree, renderProps, instance } = normalizeContextMenuPatchArgs(...patchArgs);
					const ctx = resolveContext(tree, renderProps, instance);
					if (!ctx) return;
					injectReadLaterIntoUseMessageMenu(tree, ctx.message, ctx.channel);
				} catch (err) {
					console.error("[ReadLater] menu patch", err);
				}
			};
			let menuPatchOk = false;
			for (const id of MESSAGE_MENU_IDS) {
				try {
					const un = ContextMenu.patch(id, onMessageMenu);
					if (typeof un === "function") {
						this._unpatches.push(un);
						menuPatchOk = true;
					}
				} catch (_e) {
					/* navId not registered on this build */
				}
			}
			if (!menuPatchOk)
				console.warn("[ReadLater] No message-context nav patch (Read later still works via useMessageMenu).");
			try {
				const unGlob = ContextMenu.patch("*", onMessageMenu);
				if (typeof unGlob === "function") this._unpatches.push(unGlob);
			} catch (_e) {
				/* glob navId unsupported on this BD build */
			}
		}

		try {
			patchUseMessageMenu();
		} catch (e) {
			console.warn("[ReadLater] useMessageMenu patch failed:", e);
		}
		try {
			const unAnyContext = patchAnyMessageContextMenu();
			if (typeof unAnyContext === "function") this._unpatches.push(unAnyContext);
		} catch (e) {
			console.warn("[ReadLater] Any message context patch failed:", e);
		}
		try {
			startGuildBarReadLaterObserver();
		} catch (e) {
			console.warn("[ReadLater] Guild bar observer failed:", e);
		}
		try {
			startReadLaterGlobalShortcuts();
		} catch (e) {
			console.warn("[ReadLater] Global shortcuts failed:", e);
		}
	}

	stop() {
		for (const u of this._unpatches) {
			try {
				if (typeof u === "function") u();
			} catch (_e) {}
		}
		this._unpatches = [];
		try {
			if (BdApi.Patcher && typeof BdApi.Patcher.unpatchAll === "function") BdApi.Patcher.unpatchAll("ReadLater");
		} catch (_e) {}
		_useMessageMenuPatched = false;
		try {
			closeReadLaterOverlay();
		} catch (_e) {}
		try {
			if (BdApi.DOM && typeof BdApi.DOM.removeStyle === "function") BdApi.DOM.removeStyle(STYLE_ID);
		} catch (_e) {}
		try {
			stopGuildBarReadLaterObserver();
		} catch (_e) {}
		try {
			stopReadLaterGlobalShortcuts();
		} catch (_e) {}
		_historyTransitionTo = null;
	}

	getSettingsPanel() {
		const React = BdApi.React;

		const Row = ({ entry, onRemove, onOpen }) => {
			const metaLine = formatEntryMetaLine(entry);
			return React.createElement(
				"div",
				{
					style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						padding: "8px 0",
						borderBottom: "1px solid var(--background-modifier-accent)",
					},
				},
				React.createElement(
					"div",
					{ style: { flex: 1, minWidth: 0 } },
					React.createElement("div", { style: { fontWeight: 600, fontSize: 13 } }, entry.label),
					metaLine
						? React.createElement(
								"div",
								{ style: { fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.35 } },
								metaLine,
							)
						: null,
					React.createElement(
						"div",
						{ style: { fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all", marginTop: 2 } },
						entry.url,
					),
				),
				React.createElement(
					"button",
					{
						className: "bd-button bd-button-filled bd-button-color-brand",
						style: { flexShrink: 0 },
						type: "button",
						onClick: onOpen,
					},
					"Open",
				),
				React.createElement(
					"button",
					{
						className: "bd-button bd-button-filled bd-button-color-red",
						style: { flexShrink: 0 },
						type: "button",
						onClick: onRemove,
					},
					"Remove",
				),
			);
		};

		class Panel extends React.Component {
			constructor(p) {
				super(p);
				this._recListener = null;
				this.state = {
					items: loadItems(),
					overlayBackdropPct: getOverlayBackdropOpacityPct(),
					recording: null,
					shortcutOpen: loadKeyShortcut(KEY_SHORTCUT_OPEN_QUEUE),
					shortcutSave: loadKeyShortcut(KEY_SHORTCUT_HOVER_SAVE),
					queuePageSize: getQueuePageSize(),
					queueListPage: 0,
				};
			}
			componentDidUpdate(_pp, prevState) {
				if (this.state.recording && !prevState.recording) {
					if (this._recListener) {
						try {
							window.removeEventListener("keydown", this._recListener, true);
						} catch (_e) {}
						this._recListener = null;
					}
					const modsOnly = [
						"ControlLeft",
						"ControlRight",
						"ShiftLeft",
						"ShiftRight",
						"AltLeft",
						"AltRight",
						"MetaLeft",
						"MetaRight",
					];
					this._recListener = (e) => {
						try {
							e.preventDefault();
							e.stopPropagation();
							const fn = this._recListener;
							if (e.code === "Escape") {
								if (fn)
									try {
										window.removeEventListener("keydown", fn, true);
									} catch (_e2) {}
								this._recListener = null;
								this.setState({ recording: null });
								return;
							}
							if (modsOnly.includes(e.code)) return;
							const obj = {
								code: e.code,
								ctrlKey: e.ctrlKey,
								altKey: e.altKey,
								shiftKey: e.shiftKey,
								metaKey: e.metaKey,
							};
							const keyField = this.state.recording === "open" ? KEY_SHORTCUT_OPEN_QUEUE : KEY_SHORTCUT_HOVER_SAVE;
							saveKeyShortcut(keyField, obj);
							if (fn)
								try {
									window.removeEventListener("keydown", fn, true);
								} catch (_e2) {}
							this._recListener = null;
							this.setState({
								recording: null,
								shortcutOpen: loadKeyShortcut(KEY_SHORTCUT_OPEN_QUEUE),
								shortcutSave: loadKeyShortcut(KEY_SHORTCUT_HOVER_SAVE),
							});
							toast("Shortcut saved", "success");
						} catch (err) {
							console.error("[ReadLater] keybind record", err);
						}
					};
					try {
						window.addEventListener("keydown", this._recListener, true);
					} catch (err) {
						console.error("[ReadLater] keybind attach", err);
					}
				}
				if (!this.state.recording && prevState.recording && this._recListener) {
					try {
						window.removeEventListener("keydown", this._recListener, true);
					} catch (_e) {}
					this._recListener = null;
				}
			}
			componentWillUnmount() {
				if (this._recListener) {
					try {
						window.removeEventListener("keydown", this._recListener, true);
					} catch (_e) {}
					this._recListener = null;
				}
			}
			refresh() {
				const items = loadItems();
				const queuePageSize = getQueuePageSize();
				const pageCount = Math.max(1, Math.ceil(items.length / queuePageSize));
				const maxP = pageCount - 1;
				this.setState((s) => ({
					items,
					overlayBackdropPct: getOverlayBackdropOpacityPct(),
					shortcutOpen: loadKeyShortcut(KEY_SHORTCUT_OPEN_QUEUE),
					shortcutSave: loadKeyShortcut(KEY_SHORTCUT_HOVER_SAVE),
					queuePageSize,
					queueListPage: Math.min(s.queueListPage, maxP),
				}));
			}
			render() {
				const items = this.state.items;
				const op = this.state.overlayBackdropPct;
				const so = this.state.shortcutOpen;
				const ss = this.state.shortcutSave;
				const rec = this.state.recording;
				const pageSize = this.state.queuePageSize;
				const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
				const pageSafe = Math.min(this.state.queueListPage, pageCount - 1);
				const pageItems = items.slice(pageSafe * pageSize, pageSafe * pageSize + pageSize);
				return React.createElement(
					"div",
					{ className: "local-read-later-settings" },
					React.createElement(
						"p",
						{ style: { marginBottom: 12, color: "var(--header-secondary)" } },
						"Read later saves a jump link on this device only (not sent to others). Add items from the message context menu when your client exposes it, or use the save-under-mouse shortcut below. The Read later bar is placed under the Read All block when possible. Use open later to open the list; the slider sets how solid the queue window looks (100% = not transparent).",
					),
					React.createElement(
						"div",
						{
							style: {
								marginBottom: 16,
								padding: "10px 12px",
								borderRadius: 8,
								background: "var(--background-secondary)",
								border: "1px solid var(--background-modifier-accent)",
							},
						},
						React.createElement("div", { style: { fontWeight: 600, fontSize: 13, marginBottom: 8 } }, "Keyboard shortcuts"),
						React.createElement(
							"p",
							{ style: { fontSize: 12, color: "var(--text-muted)", marginBottom: 10 } },
							"Shortcuts are disabled while typing in chat or a text field. After clicking Set shortcut, press the combination (Esc cancels).",
						),
						rec
							? React.createElement(
									"div",
									{ style: { color: "var(--brand-500)", fontSize: 12, marginBottom: 10, fontWeight: 600 } },
									rec === "open" ? "Listening for: open laterâ€¦" : "Listening for: save under mouseâ€¦",
								)
							: null,
						React.createElement(
							"div",
							{ style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 } },
							React.createElement("span", { style: { fontSize: 12, fontWeight: 600 } }, "open later"),
							React.createElement("code", { style: { fontSize: 12, color: "var(--header-primary)" } }, formatKeyShortcut(so)),
							React.createElement(
								"button",
								{
									type: "button",
									className: "bd-button bd-button-filled bd-button-color-brand",
									disabled: !!rec,
									onClick: () => this.setState({ recording: "open" }),
								},
								"Set shortcut",
							),
							React.createElement(
								"button",
								{
									type: "button",
									className: "bd-button bd-button-filled bd-button-color-red",
									disabled: !!rec,
									onClick: () => {
										saveKeyShortcut(KEY_SHORTCUT_OPEN_QUEUE, null);
										this.setState({ shortcutOpen: loadKeyShortcut(KEY_SHORTCUT_OPEN_QUEUE) });
										toast("open later shortcut cleared", "info");
									},
								},
								"Clear",
							),
						),
						React.createElement(
							"div",
							{ style: { fontSize: 11, color: "var(--text-muted)", marginBottom: 12 } },
							"Opens the same list as the Read later bar (modal or overlay).",
						),
						React.createElement(
							"div",
							{ style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 } },
							React.createElement("span", { style: { fontSize: 12, fontWeight: 600 } }, "Save message under mouse"),
							React.createElement("code", { style: { fontSize: 12, color: "var(--header-primary)" } }, formatKeyShortcut(ss)),
							React.createElement(
								"button",
								{
									type: "button",
									className: "bd-button bd-button-filled bd-button-color-brand",
									disabled: !!rec,
									onClick: () => this.setState({ recording: "hover" }),
								},
								"Set shortcut",
							),
							React.createElement(
								"button",
								{
									type: "button",
									className: "bd-button bd-button-filled bd-button-color-red",
									disabled: !!rec,
									onClick: () => {
										saveKeyShortcut(KEY_SHORTCUT_HOVER_SAVE, null);
										this.setState({ shortcutSave: loadKeyShortcut(KEY_SHORTCUT_HOVER_SAVE) });
										toast("Save-under-mouse shortcut cleared", "info");
									},
								},
								"Clear",
							),
						),
						React.createElement(
							"div",
							{ style: { fontSize: 11, color: "var(--text-muted)" } },
							"Hover the message row (not the avatar gutter), then press the shortcut. Uses the message row id and MessageStore.",
						),
					),
					React.createElement(
						"div",
						{
							style: {
								marginBottom: 16,
								padding: "10px 12px",
								borderRadius: 8,
								background: "var(--background-secondary)",
								border: "1px solid var(--background-modifier-accent)",
							},
						},
						React.createElement(
							"div",
							{ style: { fontWeight: 600, fontSize: 13, marginBottom: 8 } },
							"Queue window opacity",
						),
						React.createElement(
							"p",
							{ style: { fontSize: 12, color: "var(--text-muted)", marginBottom: 8 } },
							"100% = solid panel and strong dim (0% transparent). 0% = most see-through. Applies to the overlay and the modal queue.",
						),
						React.createElement("input", {
							type: "range",
							min: 0,
							max: 100,
							value: op,
							style: { width: "100%", maxWidth: 360 },
							onChange: (e) => {
								const v = Number(e.target.value);
								saveOverlayBackdropOpacityPct(v);
								this.setState({ overlayBackdropPct: getOverlayBackdropOpacityPct() });
							},
						}),
						React.createElement(
							"div",
							{ style: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 } },
							`${op}%`,
						),
					),
					React.createElement(
						"div",
						{
							style: {
								marginBottom: 16,
								padding: "10px 12px",
								borderRadius: 8,
								background: "var(--background-secondary)",
								border: "1px solid var(--background-modifier-accent)",
							},
						},
						React.createElement(
							"div",
							{ style: { fontWeight: 600, fontSize: 13, marginBottom: 8 } },
							"Queue list pagination",
						),
						React.createElement(
							"p",
							{ style: { fontSize: 12, color: "var(--text-muted)", marginBottom: 8 } },
							"How many entries appear on each page in the Read later bar list (overlay or modal) and below. Allowed range 1â€“50; default 10.",
						),
						React.createElement(
							"label",
							{ style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
							React.createElement("span", { style: { fontSize: 12, fontWeight: 600 } }, "Items per page"),
							React.createElement("input", {
								type: "number",
								min: 1,
								max: 50,
								value: pageSize,
								style: { width: 72 },
								onChange: (e) => {
									const raw = parseInt(e.target.value, 10);
									saveQueuePageSize(Number.isNaN(raw) ? 10 : raw);
									this.setState({ queuePageSize: getQueuePageSize(), queueListPage: 0 });
								},
							}),
						),
					),
					React.createElement(
						"div",
						{ style: { display: "flex", gap: 8, marginBottom: 12 } },
						React.createElement(
							"button",
							{
								type: "button",
								className: "bd-button bd-button-filled bd-button-color-red",
								onClick: () => {
									if (!items.length) return;
									BdApi.UI.showConfirmationModal("Clear queue", "Remove all Read later entries?", {
										onConfirm: () => {
											saveItems([]);
											this.refresh();
											toast("Queue cleared", "info");
										},
									});
								},
							},
							"Clear all",
						),
					),
					items.length
						? React.createElement(
								React.Fragment,
								null,
								...pageItems.map((e) =>
									React.createElement(Row, {
										key: e.id,
										entry: e,
										onRemove: () => {
											saveItems(items.filter((x) => x.id !== e.id));
											this.refresh();
										},
										onOpen: () => openReadLaterEntry(e),
									}),
								),
								React.createElement(
									"div",
									{
										key: "lrlq-settings-pager",
										style: {
											display: "flex",
											flexWrap: "wrap",
											alignItems: "center",
											justifyContent: "center",
											gap: 8,
											marginTop: 12,
											paddingTop: 10,
											borderTop: "1px solid var(--background-modifier-accent)",
										},
									},
									React.createElement(
										"button",
										{
											type: "button",
											className: "bd-button bd-button-filled bd-button-color-primary",
											disabled: pageSafe <= 0,
											onClick: () => this.setState({ queueListPage: Math.max(0, pageSafe - 1) }),
										},
										"Previous",
									),
									React.createElement(
										"span",
										{ style: { fontSize: 12, color: "var(--text-muted)" } },
										`Page ${pageSafe + 1} of ${pageCount} (${items.length} saved)`,
									),
									React.createElement(
										"button",
										{
											type: "button",
											className: "bd-button bd-button-filled bd-button-color-primary",
											disabled: pageSafe >= pageCount - 1,
											onClick: () => this.setState({ queueListPage: Math.min(pageCount - 1, pageSafe + 1) }),
										},
										"Next",
									),
								),
							)
						: React.createElement("p", { style: { color: "var(--text-muted)" } }, "No saved messages yet."),
				);
			}
		}
		return React.createElement(Panel, null);
	}
};

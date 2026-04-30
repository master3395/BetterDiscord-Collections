/**
 * @name MemberCounter
 * @author SyndiShanX, imafrogowo
 * @description Displays the Member Count of a Server at the top of the Member List, can be configured to show Total Members, Online Members, Offline Members, and a DM Counter.
 * @version 2.34
 * @invite yzYKRKeWNh
 * @source https://github.com/SyndiShanX/Better-Discord-Plugins/blob/main/MemberCounter/
 * @website https://syndishanx.github.io/Better-Discord-Plugins/
 */

const { Webpack: {getByKeys, getBulk, getModule, modules, Stores}, React, Patcher, Utils, Webpack } = BdApi;
const { SelectedGuildStore, GuildMemberCountStore, SelectedChannelStore, ChannelStore, ChannelMemberStore, PrivateChannelSortStore, ThreadMemberListStore } = Stores;
	
// Set Default Settings
const userSettings = {
	showTotalCounter: true,
	showOnlineCounter: true,
	showOfflineCounter: true,
	showDMsCounter: true,
	isAlwaysOnTop: true
};

class MemberCounter {
  constructor() {
		this.patches = [];
		this.MenuItems = {...getModule((m) => m.MenuRadioItem)};
  }
  addPatch(patchType, moduleToPatch, functionName, callback) {
		this.patches.push(Patcher[patchType]("MemberCounter", moduleToPatch, functionName, callback));
  }
  start() {
		Object.assign(userSettings, BdApi.Data.load("MemberCounter", "settings"));
		// Fetch the MemberList Element - Arashiryuu (export name is minified and changes with Discord builds)
		const Filters = Object.create(Webpack.Filters);
		Object.assign(Filters, {Forwarded: {byStrings: (...strings) => (m) => Filters.byStrings(...strings)(m && m.render)}});
		const querySpecs = [
			Filters.Forwarded.byStrings("renderSection:", "renderListHeader:"),
			Filters.Forwarded.byStrings("renderSection", "renderListHeader"),
			Filters.Forwarded.byStrings("renderListHeader", "MemberList"),
		];
		let bulk = null;
		for (const filt of querySpecs) {
			const b = getBulk({ filter: filt, searchExports: true, raw: true })[0];
			if (b && b.exports) {
				bulk = b;
				break;
			}
		}
		const matchMemberListComponent = (m) =>
			typeof m === "function" &&
			(Filters.Forwarded.byStrings("renderSection:", "renderListHeader:")(m) ||
				Filters.Forwarded.byStrings("renderSection", "renderListHeader")(m) ||
				(String(m.render).includes("renderListHeader") && String(m.render).includes("renderSection")));
		const resolveMemberList = (exp) => {
			if (!exp || typeof exp !== "object") return null;
			if (matchMemberListComponent(exp.default)) return exp.default;
			for (const k of Object.keys(exp)) {
				if (matchMemberListComponent(exp[k])) return exp[k];
			}
			return null;
		};
		let MemberList = resolveMemberList(bulk && bulk.exports);
		if (!MemberList) {
			const mod =
				getModule(Filters.Forwarded.byStrings("renderSection:", "renderListHeader:"), { searchExports: true }) ||
				getModule(Filters.Forwarded.byStrings("renderSection", "renderListHeader"), { searchExports: true });
			if (mod) MemberList = typeof mod === "function" ? mod : resolveMemberList(mod);
		}
		if (!MemberList) {
			const alt = getModule(
				(m) =>
					m &&
					typeof m.render === "function" &&
					/renderListHeader|MemberList|member.*list|list.*member/i.test(String(m.render)),
				{ searchExports: true },
			);
			if (alt) MemberList = typeof alt === "function" ? alt : resolveMemberList(alt);
		}
		if (!MemberList && modules) {
			for (const id of Object.keys(modules)) {
				try {
					const exp = modules[id] && modules[id].exports;
					const hit = resolveMemberList(exp);
					if (hit) {
						MemberList = hit;
						break;
					}
				} catch (_e) {}
			}
		}
		if (!MemberList) {
			console.warn("[MemberCounter] Member list module not found for this Discord build. Plugin stays inactive.");
			return;
		}

		this.addPatch('after', MemberList, 'render', (thisObj, [args], returnVal) => {
			try {
			// Fetch the Various Stores and Member Counts using BdApi
			const { groups } = ChannelMemberStore.getProps(SelectedGuildStore.getGuildId(), SelectedChannelStore.getCurrentlySelectedChannelId());
			var MemberCount = GuildMemberCountStore.getMemberCount(SelectedGuildStore.getGuildId());
			const DMCount = PrivateChannelSortStore.getSortedChannels()[1];
			// Fetch all Roles and add them together for a Pseudo Count
			var OnlineMembersCounted = 0
			for (let i = 0; i < groups.filter(group => group.id).length; i++) {
				if ( groups.filter(group => group.id)[i].id != 'offline') {
					OnlineMembersCounted = OnlineMembersCounted + groups.filter(group => group.id)[i].count
				}
			}
			// Check if the Currently Selected Channel is a Thread, Don't Render Offline Counter if True 
			var OfflineCount = parseInt(MemberCount) - parseInt(OnlineMembersCounted)
			var offlineCounter = ''
			if (String(OfflineCount).toLowerCase() != 'nan') {
				if (ChannelStore.getChannel(SelectedChannelStore.getChannelId()).threadMetadata != undefined) {
					const threadMembers = Object.entries(ThreadMemberListStore.getMemberListSections(SelectedChannelStore.getCurrentlySelectedChannelId()))
					var OnlineThreadMembersCounted = 0
					var OfflineThreadMembersCounted = 0
					// Fetch all Roles in the current Thread Channel and add them together for a Pseudo Count
					for (let i = 0; i < threadMembers.length; i++) {
						if ( threadMembers[i][0] != 'offline') {
							OnlineThreadMembersCounted = OnlineThreadMembersCounted + threadMembers[i][1]['userIds'].length
						} else {
							OfflineThreadMembersCounted = OfflineThreadMembersCounted + threadMembers[i][1]['userIds'].length
						}
					}
					MemberCount = OnlineThreadMembersCounted + OfflineThreadMembersCounted
					OfflineCount = parseInt(OfflineThreadMembersCounted)
				}
			}
			var offlineCounterStyle = {}
			if (userSettings.showOfflineCounter == false) {
				offlineCounterStyle = { display: "none" }
			} else {
				offlineCounterStyle = { color: "var(--channels-default)", padding: "24px 8px 0 16px", boxSizing: "border-box", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden", textTransform: "uppercase", fontSize: "12px", lineHeight: "16px", letterSpacing: ".02em", fontFamily: "var(--font-display)", fontWeight: "600", flex: "1 1 auto" }
			}
			offlineCounter = React.createElement("div", {
					className: "member_counter_row",
					style: { textAlign: "center" },
				},
				React.createElement("h1", {
						className: "member_counter_text offline_member_counter",
						style: offlineCounterStyle,
					},
					`🔴 Offline - ` + OfflineCount.toLocaleString()
				)
			);
			var totalCounterStyle = {}
			// Check if Total Counter is Enabled
			if (userSettings.showTotalCounter != false) {
				// Check if MemberCount is Defined and Set Bottom Margin Accordingly
				if (MemberCount != undefined) {
					// Check if Offline Counter is Defined and Set Bottom Margin Accordingly
					if (userSettings.showOnlineCounter == false && userSettings.showOfflineCounter == false) {
						totalCounterStyle = { textAlign: "center", marginBottom: "0px" }
					} else {
						totalCounterStyle = { textAlign: "center", marginBottom: "-10px" }
					}
					var totalCounter = React.createElement("div", {
							className: "member_counter_row",
							style: totalCounterStyle,
						},
						React.createElement("h1", {
								className: "member_counter_text total_member_counter",
								style: { color: "var(--channels-default)", padding: "24px 8px 0 16px", boxSizing: "border-box", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden", textTransform: "uppercase", fontSize: "12px", lineHeight: "16px", letterSpacing: ".02em", fontFamily: "var(--font-display)", fontWeight: "600", flex: "1 1 auto" },
							},
							`🔵 Total Members - ` + MemberCount.toLocaleString()
						)
					);
				}
			}
			var onlineCounterStyle = {}
			// Check if Online Counter is Enabled
			if (userSettings.showOnlineCounter != false) {
				// Check if Offline Counter is Defined and Set Bottom Margin Accordingly
				if (userSettings.showOfflineCounter == false) {
					onlineCounterStyle = { textAlign: "center", marginBottom: "0px" }
				} else {
					onlineCounterStyle = { textAlign: "center", marginBottom: "-10px" }
				}
				if (offlineCounter != '') {
					var OnlineMembersFinal = ''
					if (OnlineThreadMembersCounted != undefined) {
						OnlineMembersFinal = OnlineThreadMembersCounted.toLocaleString()
					} else {
						OnlineMembersFinal = OnlineMembersCounted.toLocaleString()
					}
					var onlineCounter = React.createElement("div", {
							className: "member_counter_row",
							style: onlineCounterStyle,
						},
						React.createElement("h1", {
								className: "member_counter_text online_member_counter",
								style: { color: "var(--channels-default)", padding: "24px 8px 0 16px", boxSizing: "border-box", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden", textTransform: "uppercase", fontSize: "12px", lineHeight: "16px", letterSpacing: ".02em", fontFamily: "var(--font-display)", fontWeight: "600", flex: "1 1 auto" },
							},
							`🟢 Online - ` + OnlineMembersFinal
						)
					);
				} else if (MemberCount != null) {
					var onlineCounter = React.createElement("div", {
							className: "member_counter_row",
							style: { textAlign: "center" },
						},
						React.createElement("h1", {
								className: "member_counter_text online_member_counter",
								style: { color: "var(--channels-default)", padding: "24px 8px 0 16px", boxSizing: "border-box", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden", textTransform: "uppercase", fontSize: "12px", lineHeight: "16px", letterSpacing: ".02em", fontFamily: "var(--font-display)", fontWeight: "600", flex: "1 1 auto" },
							},
							`🟢 Members - ` + MemberCount.toLocaleString()
						)
					);
				}
			}
			var dmCounterStyle = {}
			if (userSettings.showDMsCounter == false) {
				dmCounterStyle = { display: "none" }
			} else {
				dmCounterStyle = { color: "var(--channels-default)", padding: "24px 8px 0 16px", boxSizing: "border-box", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden", textTransform: "uppercase", fontSize: "12px", lineHeight: "16px", letterSpacing: ".02em", fontFamily: "var(--font-display)", fontWeight: "600", flex: "1 1 auto" }
			}
			const dmCounter = React.createElement("div", {
					className: "member_counter_row",
					style: { textAlign: "center", marginTop: "-20px", marginBottom: "15px" },
				},
				React.createElement("h3", {
						className: "member_counter_text dm_counter",
						style: dmCounterStyle,
					},
					`DMs - ${DMCount && DMCount.length != null ? DMCount.length.toLocaleString() : "0"}`
				)
			);
			var counterWrapperStyle = {}
			if (userSettings.isAlwaysOnTop == false) {
				counterWrapperStyle = { paddingBottom: "24px", borderBottom: "var(--border-subtle) 1px solid" }
			} else {
				counterWrapperStyle = { position: "sticky", top: "0px", zIndex: "999", background: "inherit", paddingBottom: "24px", borderBottom: "var(--border-subtle) 1px solid" }
			}
			const counterWrapper = MemberCount != null && MemberCount.toLocaleString() !== undefined ? (
				React.createElement("div", {
						className: "member_counter_wrapper",
						style: counterWrapperStyle,
					},
					null, totalCounter, onlineCounter, offlineCounter
				)
			) : (
				React.createElement("div", {
						className: "dm_counter_wrapper",
						style: { textAlign: "center" },
					},
					dmCounter
				)
			);
			
			// Debug Logs
			//console.log(returnVal)
			//console.log(returnVal.props.className)
			
			// Append Counter Elements | Selects Member List | Selects DM List
			const props = returnVal && returnVal.props;
			if (!props) return;

			const firstToken =
				typeof props.className === "string" ? props.className.trim().split(/\s+/)[0] : "";
			const listId = props["data-list-id"];
			const isMembersList = firstToken.startsWith("members");
			const isPrivateDmList =
				props.id !== "channels" &&
				typeof listId === "string" &&
				listId.startsWith("private");

			if (isMembersList) {
				const children = props.children;
				if (Array.isArray(children)) {
					children.splice(0, 0, counterWrapper);
					props.children = children;
				}
			} else if (isPrivateDmList) {
				const dm0 = props.children && props.children[0];
				const dmChildren = dm0 && dm0.props && dm0.props.children && dm0.props.children.props && dm0.props.children.props.children;
				if (Array.isArray(dmChildren)) {
					dmChildren.splice(1, 0, counterWrapper);
					props.children[0].props.children.props.children = dmChildren;
				}
			}
			} catch (err) {
				try {
					console.error("[MemberCounter] render patch:", err);
				} catch (_) {}
			}
		});
  }
  stop() {
		this.patches.forEach((x) => x());
  }
	getSettingsPanel() {
		return BdApi.UI.buildSettingsPanel({
			settings: [
				{
					type: "switch",
					id: "switch",
					name: "Show Total Members Counter: ",
					value: userSettings["showTotalCounter"],
					onChange: (value) => {
						userSettings["showTotalCounter"] = value;
					}
				},
				{
					type: "switch",
					id: "switch",
					name: "Show Online Members Counter: ",
					value: userSettings["showOnlineCounter"],
					onChange: (value) => {
						userSettings["showOnlineCounter"] = value;
					}
				},
				{
					type: "switch",
					id: "switch",
					name: "Show Offline Members Counter: ",
					value: userSettings["showOfflineCounter"],
					onChange: (value) => {
						userSettings["showOfflineCounter"] = value;
					}
				},
				{
					type: "switch",
					id: "switch",
					name: "Show DMs Counter: ",
					value: userSettings["showDMsCounter"],
					onChange: (value) => {
						userSettings["showDMsCounter"] = value;
					}
				},
				{
					type: "switch",
					id: "switch",
					name: "Always on Top: ",
					value: userSettings["isAlwaysOnTop"],
					onChange: (value) => {
						userSettings["isAlwaysOnTop"] = value;
					}
				}
			],
			onChange: (category, id, value) => BdApi.Data.save("MemberCounter", "settings", userSettings),
		});
  }
}

module.exports = MemberCounter
/**
 * @name ProProfile
 * @author EhsanDavari
 * @authorId 553139953597677568
 * @version 1.0.3
 * @description  with this plugin : You can copy the user banner (banner color and banner photo) You can copy the user's profile picture You can copy About Me to the user You can also copy the user bio
 * @invite xfvHwqXXKs
 * @website https://www.beheshtmarket.com
 * @source https://github.com/iamehsandvr/ProProfile
 * @updateUrl https://raw.githubusercontent.com/iamehsandvr/ProBanner/main/ProProfile.plugin.js
 */

const fs = require("fs");
const path = require("path");

function _ppToast(message, options) {
  if (typeof BdApi !== "undefined" && BdApi.UI && typeof BdApi.UI.showToast === "function")
    return BdApi.UI.showToast(message, options);
  if (typeof BdApi !== "undefined" && typeof BdApi.showToast === "function")
    return BdApi.showToast(message, options);
}

const config = {
  info: {
    name: "ProProfile",
    authors: [
      {
        name: "EhsanDavari",
      },
    ],
    version: "1.0.3",
    description:
      " with this plugin : You can copy the user banner (banner color and banner photo) You can copy the user's profile picture You can copy About Me to the user You can also copy the user bio",
    changelog: [
      {
        title: "Cool Update",
        type: "improved",
        items: [
          "Double-click to copy the server profile",
          "Double-click to copy the server banner ",
          "برای کپی کردن پروفایل سرور دوبار کلیک کنید",
          "برای کپی کردن بنر سرور دوبار کلیک کنید",
        ],
      },
    ],
  },
};

module.exports = !global.ZeresPluginLibrary
  ? class {
      constructor() {
        this._config = config;
      }

      load() {
        BdApi.showConfirmationModal(
          "Library plugin is needed",
          `The library plugin needed for AQWERT'sPluginBuilder is missing. Please click Download Now to install it.`,
          {
            confirmText: "Download",
            cancelText: "Cancel",
            onConfirm: () => {
              const { shell } = require("electron");
              const url = "https://rauenzi.github.io/BDPluginLibrary/release/0PluginLibrary.plugin.js";
              const dest = path.join(BdApi.Plugins.folder, "0PluginLibrary.plugin.js");
              const fallback =
                "https://betterdiscord.net/ghdl?url=https://raw.githubusercontent.com/rauenzi/BDPluginLibrary/master/release/0PluginLibrary.plugin.js";
              if (BdApi.Net && typeof BdApi.Net.fetch === "function") {
                BdApi.Net.fetch(url)
                  .then((r) => (r && r.ok ? r.text() : Promise.reject()))
                  .then((body) => fs.writeFileSync(dest, body))
                  .catch(() => shell.openExternal(fallback));
              } else {
                require("request").get(url, (error, _response, body) => {
                  if (error) return shell.openExternal(fallback);
                  fs.writeFileSync(dest, body);
                });
              }
            },
          }
        );
      }

      start() {}

      stop() {}
    }
  : (([Plugin, Library]) => {
      const {
        DiscordModules,
        WebpackModules,
        Patcher,
        PluginUtilities,
        Toasts,
      } = Library;
      const { ElectronModule, React } = DiscordModules;
      class plugin extends Plugin {
        constructor() {
          super();
        }
        onStart() {
          this.ProProfile();
        }

        onStop() {
          Patcher.unpatchAll();
        }
        ProProfile() {
          const resolveByDisplayName = (displayName) => {
            let m = WebpackModules.find((x) => x?.default?.displayName === displayName);
            if (m) return m;
            try {
              if (typeof BdApi !== "undefined" && BdApi.Webpack && typeof BdApi.Webpack.getModule === "function") {
                m = BdApi.Webpack.getModule(
                  (x) =>
                    x &&
                    x.default &&
                    (x.default.displayName === displayName ||
                      x.default.name === displayName),
                  { searchExports: true },
                );
              }
            } catch (_e) {}
            return m || null;
          };
          const NameTag = resolveByDisplayName("NameTag");
          const UserBio = WebpackModules.find(
            (m) => m?.default?.displayName === "UserBio"
          );
          const UserBanner = resolveByDisplayName("UserBanner");
          const CustomStatus = WebpackModules.find(
            (m) => m?.default?.displayName === "CustomStatus"
          );
          document.addEventListener("dblclick", ({ target }) => {
            if (new RegExp(/guild*/).test(target.dataset.listItemId)) {
              global.ZLibrary.DiscordModules.ElectronModule.copy(
                target.children[0].currentSrc.replace(/([0-9]+)$/, "4096")
              );
              return _ppToast(`Server icon link successfully copied`, {
                type: "success",
              });
            } else if (
              new RegExp(/animatedBannerHoverLayer*/).test(target.className)
            ) {
              global.ZLibrary.DiscordModules.ElectronModule.copy(
                `https://cdn.discordapp.com/banners/${target.__reactFiber$.return.memoizedProps.guild.id}/${target.__reactFiber$.return.memoizedProps.guildBanner}.gif?size=4096`
              );
              return _ppToast(`Server banner link successfully copied`, {
                type: "success",
              });
            } else if (new RegExp(/height:*/).test(target.style.cssText)) {
              var strGuildBanner = document.getElementsByClassName(
                "animatedContainer-2laTjx"
              );
              global.ZLibrary.DiscordModules.ElectronModule.copy(
                strGuildBanner[0].children[0].children[0].currentSrc.replace(
                  /([0-9]+)$/,
                  "4096"
                )
              );
              return _ppToast(`Server icon link successfully copied`, {
                type: "success",
              });
            }
          });
          document.addEventListener("click", ({ target }) => {
            if (
              target.ariaLabel &&
              target.style.cssText &&
              new RegExp(/avatar\-3QF_VA/).test(target.className)
            ) {
              let MemberProfileUrl =
                target.__reactProps$.children.props.children[0].props
                  .children[0].props.children.props.src;
              MemberProfileUrl = new RegExp(/assets/).test(MemberProfileUrl)
                ? `https://discord.com${MemberProfileUrl}`
                : MemberProfileUrl.replace(/([0-9]+)$/, "4096");
              global.ZLibrary.DiscordModules.ElectronModule.copy(
                MemberProfileUrl
              );
              return _ppToast(`User profile image link successfully`, {
                type: "success",
              });
            }
          });
          if (NameTag)
            Patcher.after(NameTag, "default", (_, [props], ret) => {
              ret.props.style = {
                cursor: "pointer",
              };
              ret.props.onClick = (_) => {
                ElectronModule.copy(`${props.name}#${props.discriminator}`);
                Toasts.success(
                  `Successfully copied username for <strong>${props.name}</strong>!`
                );
              };
            });
          else
            console.warn("ProProfile: NameTag module not found; username copy patch skipped.");
          if (!UserBanner) {
            console.warn("ProProfile: UserBanner module not found; banner patch skipped.");
          } else {
          Patcher.after(UserBanner, "default", (_, [props], ret) => {
            ret.props.onClick = (_) => {
              //let ClassBanner = BdApi.findModuleByProps("banner", "bannerOverlay")
              if (
                _.target.classList.contains("banner-1YaD3N") &&
                _.target.style.backgroundImage
              ) {
                let BannerUrl = _.target.style.backgroundImage;
                BannerUrl = BannerUrl.substring(
                  4,
                  BannerUrl.length - 1
                ).replace(/["']/g, "");
                BannerUrl = BannerUrl.replace(
                  /(?:\?size=\d{3,4})?$/,
                  "?size=4096"
                );
                ElectronModule.copy(BannerUrl);
                return Toasts.success("Banner link was successfully copied");
              } else if (_.target.style.backgroundColor) {
                const ColorCode = _.target.style.backgroundColor;
                var RGBColorCode = ColorCode.replaceAll(
                  /[a-z() ]+/gi,
                  ""
                ).split(",");
                const RGB2HEX = {
                  r: Number(RGBColorCode[0]).toString(16),
                  g: Number(RGBColorCode[1]).toString(16),
                  b: Number(RGBColorCode[2]).toString(16),
                };
                const ColorHexCode =
                  "#" +
                  (RGB2HEX.r.length == 1 ? 0 + RGB2HEX.r : RGB2HEX.r) +
                  (RGB2HEX.g.length == 1 ? 0 + RGB2HEX.g : RGB2HEX.g) +
                  (RGB2HEX.b.length == 1 ? 0 + RGB2HEX.b : RGB2HEX.b);
                ElectronModule.copy(ColorHexCode);
                return Toasts.success(
                  `Hex color code : ${ColorHexCode} was successfully copied`
                );
              }
            };
            document.addEventListener("click", (target) => {
              if (target.ariaLabel && target.style.cssText) {
                let MemberProfileUrl =
                  target.__reactProps$.children.props.children[0].props.children
                    .props.src;
                MemberProfileUrl = new RegExp(/assets/).test(MemberProfileUrl)
                  ? `https://discord.com${MemberProfileUrl}`
                  : MemberProfileUrl.replace(/([0-9]+)$/, "4096");
                global.ZLibrary.DiscordModules.ElectronModule.copy(
                  MemberProfileUrl
                );
                return _ppToast(`User profile image link successfully`, {
                  type: "success",
                });
              }
            });
          });
          }
          if (UserBio) {
            Patcher.after(UserBio, "default", (_, [props], ret) => {
              ret.props.style = {
                cursor: "pointer",
              };
              ret.props.onClick = (_) => {
                ElectronModule.copy(props.userBio);
                Toasts.success(`Successfully copied <strong>User Bio</strong>! `);
              };
            });
          }
          if (CustomStatus) {
            Patcher.after(CustomStatus, "default", (_, [props], ret) => {
              ret.props.style = {
                cursor: "pointer",
              };
              ret.props.onClick = (_) => {
                "state" in props.activity && !("emoji" in props.activity)
                  ? ElectronModule.copy(`${props.activity.state}`)
                  : "emoji" in props.activity && "state" in props.activity
                  ? ElectronModule.copy(
                      `${props.activity.emoji.name} ${props.activity.state}`
                    )
                  : ElectronModule.copy(`${props.activity.emoji.name}`);
                Toasts.success(
                  `Successfully copied <strong>User Status</strong>! `
                );
              };
            });
          }
        }
      }

      return plugin;
    })(global.ZeresPluginLibrary.buildPlugin(config));

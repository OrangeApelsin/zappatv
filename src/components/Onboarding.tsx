import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { encode } from "uqr";
import { useLocale } from "../hooks/useLocale";
import { useSettings } from "../stores/settings";
import { useSetup } from "../stores/setup";
import { KEY, useRemote } from "../hooks/useRemote";
import { useSpatialNav } from "../hooks/useSpatialNav";
import {
  checkPlaylistUrl,
  DEFAULT_IPTV_MANAGER_SERVER,
  iptvManagerSource,
  m3uSource,
  nameFromUrl,
  parseXtreamTemplateUrl,
  type PlaylistSource,
  sourceDisplay,
  xtreamFromServerField,
  xtreamSource,
  type XtreamSource,
} from "../services/playlistUrl";
import type { MessageKey } from "../services/locale";
import { Icon } from "./Icon";
import { LanguagePicker } from "./LanguagePicker";
import { OptionPicker } from "./OptionPicker";
import { KeyGuide } from "./KeyGuide";
import { InputShield } from "./InputShield";
import type { PairingSessionView } from "../services/deviceAccess";
import type { RemoteAccessState } from "../services/remoteServer";

const NO_REMOTE_ACCESS: RemoteAccessState = {
  status: "unavailable",
  address: "",
  port: 0,
  remotePath: "",
  pairing: null,
  pairingError: false,
  connectedDevice: "",
  error: "",
};

export type SetupTab = "phone" | "token" | "xtream" | "m3u";

export function Onboarding({
  onAdd,
  onExit,
  remoteAccess = NO_REMOTE_ACCESS,
  onOpenPairing,
  showRemoteSetup = false,
}: {
  onAdd: (name: string, source: PlaylistSource) => void;
  /** RETURN here closes the application, because this screen is the application's home. */
  onExit: () => void;
  remoteAccess?: RemoteAccessState;
  onOpenPairing?: () => PairingSessionView | null;
  showRemoteSetup?: boolean;
}) {
  const { t, direction } = useLocale();
  const settings = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const manual = useRef<HTMLElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const phoneTabRef = useRef<HTMLButtonElement>(null);
  const tokenTabRef = useRef<HTMLButtonElement>(null);
  const xtreamTabRef = useRef<HTMLButtonElement>(null);
  const m3uTabRef = useRef<HTMLButtonElement>(null);

  const { move } = useSpatialNav(box, true);
  const { name, source, set: setSetup } = useSetup();
  const [problem, setProblem] = useState<MessageKey | "">("");
  const [dismissedXtreamUrl, setDismissedXtreamUrl] = useState("");

  const isTokenMode = source.kind === "xtream" && source.token !== undefined;

  const [activeTab, setActiveTab] = useState<SetupTab>(() => {
    if (showRemoteSetup && remoteAccess.status === "listening") return "phone";
    if (isTokenMode) return "token";
    if (source.kind === "xtream") return "xtream";
    return "m3u";
  });

  const url = source.kind === "m3u" ? source.url : "";
  const suggestedXtream =
    source.kind === "m3u" && source.url !== dismissedXtreamUrl
      ? parseXtreamTemplateUrl(source.url, "ts")
      : null;
  const server = source.kind === "xtream" ? source.server : "";
  const username = source.kind === "xtream" ? source.username : "";
  const password = source.kind === "xtream" ? source.password : "";
  const output = source.kind === "xtream" ? source.output : "ts";

  const currentXtream: XtreamSource = useMemo(
    () =>
      source.kind === "xtream"
        ? source
        : { kind: "xtream", server: "", username: "", password: "", output: "ts" },
    [source],
  );

  // Focus initial input field on mount
  useEffect(() => {
    first.current?.focus();
  }, []);

  // Sync activeTab if source changes from external device / remote
  useEffect(() => {
    if (source.kind === "m3u" && source.url) {
      setActiveTab("m3u");
    } else if (source.kind === "xtream") {
      if (source.token !== undefined) {
        setActiveTab("token");
      } else {
        setActiveTab("xtream");
      }
    }
  }, [source]);

  // Remote setup URL for phone QR pairing
  const address = remoteAccess.address
    ? `http://${remoteAccess.address}:${remoteAccess.port}${remoteAccess.remotePath}`
    : "";
  const setupUrl = useMemo(
    () =>
      remoteAccess.pairing && address
        ? `${address}#pair=${encodeURIComponent(remoteAccess.pairing.secret)}`
        : "",
    [address, remoteAccess.pairing],
  );

  // Trigger pairing session when phone tab is activated
  useEffect(() => {
    if (
      activeTab === "phone" &&
      onOpenPairing &&
      !remoteAccess.pairing &&
      remoteAccess.status === "listening"
    ) {
      onOpenPairing();
    }
  }, [activeTab, onOpenPairing, remoteAccess.pairing, remoteAccess.status]);

  // Render QR Canvas when active tab is phone
  useEffect(() => {
    if (activeTab !== "phone" || !canvasRef.current || !setupUrl) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;
    try {
      const qr = encode(setupUrl, { ecc: "M" });
      const margin = 2;
      const modules = qr.size + margin * 2;
      const scale = 340 / modules;
      canvas.width = 340;
      canvas.height = 340;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 340, 340);
      ctx.fillStyle = "#000000";
      for (let r = 0; r < qr.size; r += 1) {
        for (let c = 0; c < qr.size; c += 1) {
          if (qr.data[r][c]) {
            ctx.fillRect(
              Math.floor((c + margin) * scale),
              Math.floor((r + margin) * scale),
              Math.ceil(scale),
              Math.ceil(scale),
            );
          }
        }
      }
    } catch {
      // Ignored if encoding fails
    }
  }, [activeTab, setupUrl]);

  const moveWelcomeVertical = (code: number) => {
    const container = manual.current;
    if (!container) return false;
    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".setup-tabs button, .playlist-source-options button"),
    );
    const selectedTab =
      tabs.find((button) => button.getAttribute("aria-pressed") === "true") ?? tabs[0];
    const active = document.activeElement as HTMLElement | null;
    const tabFocus = tabs.includes(active as HTMLButtonElement) ? active : selectedTab;
    const ordered = Array.from(
      container.querySelectorAll<HTMLElement>(
        "button:not([hidden]):not([disabled]):not([tabindex='-1']), input:not([hidden]):not([disabled]):not([tabindex='-1'])",
      ),
    ).filter(
      (element) => !tabs.includes(element as HTMLButtonElement) || element === tabFocus,
    );
    if (!ordered.length) return false;
    const current = Math.max(0, ordered.indexOf(active as HTMLElement));
    const delta = code === KEY.DOWN ? 1 : -1;
    ordered[(current + delta + ordered.length) % ordered.length].focus();
    return true;
  };

  const captureWelcomeVertical = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.keyCode !== KEY.UP && event.keyCode !== KEY.DOWN) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && !active.readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    moveWelcomeVertical(event.keyCode);
  };

  const moveFromTab = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
    const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
    if (event.keyCode === inlineStart || event.keyCode === inlineEnd) {
      event.preventDefault();
      event.stopPropagation();
      const buttons = [
        phoneTabRef.current,
        tokenTabRef.current,
        xtreamTabRef.current,
        m3uTabRef.current,
      ].filter((button): button is HTMLButtonElement => button !== null);
      const index = buttons.indexOf(event.currentTarget);
      const nextIndex =
        event.keyCode === inlineStart
          ? Math.max(0, index - 1)
          : Math.min(buttons.length - 1, index + 1);
      buttons[nextIndex]?.focus();
      return;
    }
    if (event.keyCode === KEY.DOWN) {
      event.preventDefault();
      event.stopPropagation();
      moveWelcomeVertical(KEY.DOWN);
    }
  };

  const applyXtream = (next: NonNullable<typeof suggestedXtream>) => {
    setActiveTab("xtream");
    setSetup({ name, source: next });
    setProblem("");
  };

  const submit = () => {
    if (activeTab === "m3u") {
      const verdict = checkPlaylistUrl(source.kind === "m3u" ? source.url : "");
      if (!verdict.ok) {
        setProblem(verdict.problemKey ?? "validation.completeAddress");
        return;
      }
      const valid = m3uSource(source.kind === "m3u" ? source.url : "");
      if (!valid) return;
      onAdd(name.trim() || nameFromUrl(sourceDisplay(valid)), valid);
      useSetup.getState().clear();
      return;
    }

    if (activeTab === "token") {
      const tokenVal = (source.kind === "xtream" ? source.token : "")?.trim() ?? "";
      const serverVal =
        (source.kind === "xtream" ? source.server : "")?.trim() || DEFAULT_IPTV_MANAGER_SERVER;
      if (!tokenVal) {
        setProblem("validation.completeAddress");
        return;
      }
      const valid = iptvManagerSource(serverVal, tokenVal, "ts");
      if (!valid) {
        setProblem("validation.completeAddress");
        return;
      }
      onAdd(name.trim() || nameFromUrl(sourceDisplay(valid)), valid);
      useSetup.getState().clear();
      return;
    }

    const valid = xtreamSource(
      source.kind === "xtream" ? source.server : "",
      source.kind === "xtream" ? source.username : "",
      source.kind === "xtream" ? source.password : "",
      source.kind === "xtream" ? source.output : "ts",
    );
    if (!valid) {
      setProblem("validation.completeAddress");
      return;
    }
    onAdd(name.trim() || nameFromUrl(sourceDisplay(valid)), valid);
    useSetup.getState().clear();
  };

  useRemote((code, event) => {
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      const typing = document.activeElement instanceof HTMLInputElement;
      if (typing) (document.activeElement as HTMLInputElement).blur();
      else onExit();
      return;
    }
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement;
    if (!typing && code === KEY.ENTER && active instanceof HTMLButtonElement) {
      event.preventDefault();
      active.click();
      return;
    }
    if (typing && code === KEY.ENTER) {
      event.preventDefault();
      submit();
      return;
    }
    if (typing && code !== KEY.UP && code !== KEY.DOWN) return;
    if (
      (code === KEY.UP || code === KEY.DOWN) &&
      active instanceof HTMLElement &&
      manual.current?.contains(active)
    ) {
      event.preventDefault();
      moveWelcomeVertical(code);
      return;
    }
    if ([KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT].includes(code as never)) {
      event.preventDefault();
      move(code);
    }
  });

  return (
    <div className="onboard">
      <div className="onboard-box setup-wrap" ref={box}>
        <section
          className="onboard-manual"
          ref={manual}
          onKeyDownCapture={captureWelcomeVertical}
        >
          <header className="onboard-head">
            <div className="brand setup-brand">
              <img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true" />
              <h1>Zappa TV</h1>
            </div>
            <div className="onboard-language">
              <span className="onboard-language-label">
                <Icon name="language" />
                {t("settings.language")}
              </span>
              <LanguagePicker
                value={settings.locale}
                onChange={(id) => settings.set("locale", id)}
              />
            </div>
          </header>

          <h2 className="setup-title">{t("onboarding.title")}</h2>

          <div
            className="setup-tabs playlist-source-options"
            id="setup-tabs"
            role="tablist"
          >
            <button
              ref={phoneTabRef}
              type="button"
              className={`tab ${activeTab === "phone" ? "active" : ""}`}
              aria-pressed={activeTab === "phone"}
              onKeyDown={moveFromTab}
              onClick={() => {
                setActiveTab("phone");
                if (onOpenPairing && !remoteAccess.pairing) {
                  onOpenPairing();
                }
              }}
            >
              <span>{t("onboarding.fromPhone")}</span>
            </button>
            <button
              ref={tokenTabRef}
              type="button"
              className={`tab ${activeTab === "token" ? "active" : ""}`}
              aria-pressed={activeTab === "token"}
              onKeyDown={moveFromTab}
              onClick={() => {
                setActiveTab("token");
                setSetup({
                  name,
                  source: {
                    kind: "xtream",
                    server:
                      source.kind === "xtream" && source.server ? source.server : "",
                    username: source.kind === "xtream" && source.token ? source.token : "",
                    password: source.kind === "xtream" && source.token ? source.token : "",
                    output: "ts",
                    token: source.kind === "xtream" && source.token ? source.token : "",
                  },
                });
                setProblem("");
              }}
            >
              <span>{t("onboarding.tokenTab")}</span>
            </button>
            <button
              ref={xtreamTabRef}
              type="button"
              className={`tab ${activeTab === "xtream" ? "active" : ""}`}
              aria-pressed={activeTab === "xtream"}
              aria-label={t("onboarding.xtreamLogin")}
              onKeyDown={moveFromTab}
              onClick={() => {
                setActiveTab("xtream");
                setSetup({
                  name,
                  source: {
                    kind: "xtream",
                    server: source.kind === "xtream" && !isTokenMode ? source.server : "",
                    username: source.kind === "xtream" && !isTokenMode ? source.username : "",
                    password: source.kind === "xtream" && !isTokenMode ? source.password : "",
                    output: source.kind === "xtream" && !isTokenMode ? source.output : "ts",
                  },
                });
                setProblem("");
              }}
            >
              <span>Xtream Codes</span>
            </button>
            <button
              ref={m3uTabRef}
              type="button"
              className={`tab ${activeTab === "m3u" ? "active" : ""}`}
              aria-pressed={activeTab === "m3u"}
              aria-label={t("onboarding.m3uPlaylist")}
              onKeyDown={moveFromTab}
              onClick={() => {
                setActiveTab("m3u");
                setSetup({
                  name,
                  source: { kind: "m3u", url: source.kind === "m3u" ? source.url : "" },
                });
                setProblem("");
              }}
            >
              <span>M3U / M3U8</span>
            </button>
          </div>

          {activeTab === "phone" && (
            <div className="fields" id="fields-phone">
              <div className="pair">
                <div
                  className={`pair-code ${!setupUrl || (remoteAccess.status === "unavailable" && Boolean(remoteAccess.error)) ? "blank" : ""}`}
                  id="pair-code"
                >
                  <canvas
                    ref={canvasRef}
                    id="pair-qr"
                    width={340}
                    height={340}
                    role="img"
                    aria-label={t("remote.qrAlt")}
                  />
                </div>
                <div className="pair-text">
                  {remoteAccess.status === "unavailable" && remoteAccess.error ? (
                    <div className="pair-unavailable-notice" style={{ marginTop: 8 }}>
                      <p style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                        {t("remote.unavailable")}
                      </p>
                      <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.4, marginBottom: 16 }}>
                        Remote phone setup is not available on this TV model. Please enter your playlist using the on-screen form.
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ minHeight: 44, padding: "0 24px", borderRadius: "var(--r-pill)" }}
                        onClick={() => setActiveTab("token")}
                      >
                        <span>{t("onboarding.tokenTab")}</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="pair-step">
                        <b>1</b>
                        <span>{t("onboarding.pairStep1")}</span>
                      </p>
                      <p className="pair-step">
                        <b>2</b>
                        <span>{t("onboarding.pairStep2")}</span>
                      </p>
                      {address && (
                        <div
                          className="remote-manual"
                          style={{ marginTop: 16, alignItems: "flex-start", textAlign: "left" }}
                        >
                          <span>{t("remote.addressHint")}</span>
                          <strong dir="ltr">{address}</strong>
                          {remoteAccess.pairing && (
                            <>
                              <span style={{ marginTop: 8 }}>{t("remote.codeHint")}</span>
                              <strong
                                className="remote-code"
                                dir="ltr"
                                style={{ fontSize: 24, letterSpacing: "0.15em" }}
                              >
                                {`${remoteAccess.pairing.code.slice(0, 3)} ${remoteAccess.pairing.code.slice(3)}`}
                              </strong>
                              <span
                                style={{ marginTop: 4, fontSize: 15, color: "var(--text-3)" }}
                              >
                                {t("remote.expires")}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <p
                    className={`pair-status ${remoteAccess.pairingError || remoteAccess.status === "unavailable" ? "bad" : ""}`}
                    role="status"
                  >
                    {remoteAccess.status === "unavailable"
                      ? t("remote.unavailable")
                      : remoteAccess.connectedDevice
                        ? t("remote.connected", { name: remoteAccess.connectedDevice })
                        : remoteAccess.status === "listening"
                          ? t("onboarding.waitingPhone")
                          : t("remote.starting")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "token" && (
            <div className="fields setup-form" id="fields-token">
              <label className="field" htmlFor="ob-server">
                <span>{t("onboarding.serverAddress")}</span>
                <InputShield
                  id="ob-server"
                  value={server}
                  spellCheck={false}
                  dir="ltr"
                  placeholder={DEFAULT_IPTV_MANAGER_SERVER}
                  onChange={(event) => {
                    setSetup({
                      name,
                      source: {
                        kind: "xtream",
                        server: event.target.value,
                        username: source.kind === "xtream" && source.token ? source.token : "",
                        password: source.kind === "xtream" && source.token ? source.token : "",
                        token: source.kind === "xtream" && source.token ? source.token : "",
                        output: "ts",
                      },
                    });
                    setProblem("");
                  }}
                />
              </label>
              <label className="field" htmlFor="ob-token">
                <span>{t("onboarding.clientToken")}</span>
                <InputShield
                  id="ob-token"
                  ref={first}
                  value={source.kind === "xtream" ? source.token ?? "" : ""}
                  spellCheck={false}
                  dir="ltr"
                  placeholder="e.g. 8a9f2b1c4e7d"
                  onChange={(event) => {
                    const val = event.target.value;
                    setSetup({
                      name,
                      source: {
                        kind: "xtream",
                        server,
                        username: val,
                        password: val,
                        token: val,
                        output: "ts",
                      },
                    });
                    setProblem("");
                  }}
                />
              </label>
              <label className="field" htmlFor="ob-name">
                <span>{t("onboarding.nameOptional")}</span>
                <InputShield
                  id="ob-name"
                  value={name}
                  dir="auto"
                  placeholder={t("onboarding.takenFromAddress")}
                  onChange={(e) => setSetup({ name: e.target.value, source })}
                />
              </label>
              {problem && (
                <p className="field-problem" id="ob-token-problem" role="alert">
                  {t(problem)}
                </p>
              )}
              <div className="setup-actions">
                <button
                  type="button"
                  className="btn primary filled wide"
                  onClick={submit}
                >
                  {t("common.addPlaylist")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "xtream" && (
            <div className="fields setup-form" id="fields-xtream">
              <label className="field" htmlFor="ob-server">
                <span>{t("onboarding.serverAddress")}</span>
                <InputShield
                  id="ob-server"
                  value={server}
                  spellCheck={false}
                  dir="ltr"
                  onChange={(event) => {
                    setSetup({
                      name,
                      source: xtreamFromServerField(currentXtream, event.target.value),
                    });
                    setProblem("");
                  }}
                />
              </label>
              <label className="field" htmlFor="ob-username">
                <span>{t("onboarding.username")}</span>
                <InputShield
                  id="ob-username"
                  value={username}
                  spellCheck={false}
                  dir="ltr"
                  onChange={(event) =>
                    setSetup({ name, source: { ...currentXtream, username: event.target.value } })
                  }
                />
              </label>
              <label className="field" htmlFor="ob-password">
                <span>{t("onboarding.password")}</span>
                <InputShield
                  id="ob-password"
                  type="password"
                  value={password}
                  dir="ltr"
                  onChange={(event) =>
                    setSetup({ name, source: { ...currentXtream, password: event.target.value } })
                  }
                />
              </label>
              <label className="field" htmlFor="ob-output">
                <span>{t("onboarding.streamFormat")}</span>
                <OptionPicker
                  id="ob-output"
                  label={t("onboarding.streamFormat")}
                  value={output}
                  options={[
                    { value: "m3u8", label: t("onboarding.hls") },
                    { value: "ts", label: t("onboarding.mpegTs") },
                  ]}
                  onChange={(value) =>
                    setSetup({ name, source: { ...currentXtream, output: value } })
                  }
                />
              </label>
              <label className="field" htmlFor="ob-name">
                <span>{t("onboarding.nameOptional")}</span>
                <InputShield
                  id="ob-name"
                  value={name}
                  dir="auto"
                  placeholder={t("onboarding.takenFromAddress")}
                  onChange={(e) => setSetup({ name: e.target.value, source })}
                />
              </label>
              {problem && (
                <p className="field-problem" id="ob-xtream-problem" role="alert">
                  {t(problem)}
                </p>
              )}
              <div className="setup-actions">
                <button
                  type="button"
                  className="btn primary filled wide"
                  onClick={submit}
                  disabled={!sourceDisplay(source).trim()}
                >
                  {t("common.addPlaylist")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "m3u" && (
            <div className="fields setup-form" id="fields-m3u">
              <label className="field" htmlFor="ob-url">
                <span>{t("onboarding.playlistAddress")}</span>
                <InputShield
                  id="ob-url"
                  ref={first}
                  value={url}
                  spellCheck={false}
                  dir="ltr"
                  className={problem ? "wrong" : ""}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? "ob-url-problem" : undefined}
                  placeholder={t("onboarding.urlPlaceholder")}
                  onChange={(e) => {
                    setSetup({ name, source: { kind: "m3u", url: e.target.value } });
                    setProblem("");
                  }}
                />
              </label>

              {/* Shortcut chip row */}
              <div className="setup-chips" id="m-chips">
                {[
                  { label: "http://", put: "http://" },
                  { label: "https://", put: "https://" },
                  { label: ".com", put: ".com" },
                  { label: "/get.php?username=", put: "/get.php?username=" },
                  { label: "&password=", put: "&password=" },
                  { label: "&type=m3u_plus", put: "&type=m3u_plus" },
                  { label: t("onboarding.clear"), put: "" },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    className="chip"
                    onClick={() => {
                      if (!chip.put) {
                        setSetup({ name, source: { kind: "m3u", url: "" } });
                      } else {
                        const currentUrl = source.kind === "m3u" ? source.url : "";
                        setSetup({
                          name,
                          source: { kind: "m3u", url: currentUrl + chip.put },
                        });
                      }
                      setProblem("");
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {suggestedXtream && (
                <div className="xtream-suggestion">
                  <span>{t("onboarding.xtreamDetected")}</span>
                  <div>
                    <button
                      type="button"
                      className="btn tonal"
                      onClick={() => setDismissedXtreamUrl(url)}
                    >
                      <span>{t("onboarding.keepM3u")}</span>
                    </button>
                    <button
                      type="button"
                      className="btn tonal"
                      onClick={() => applyXtream(suggestedXtream)}
                    >
                      <span>{t("onboarding.useXtream")}</span>
                    </button>
                  </div>
                </div>
              )}

              <label className="field" htmlFor="ob-name">
                <span>{t("onboarding.nameOptional")}</span>
                <InputShield
                  id="ob-name"
                  value={name}
                  dir="auto"
                  placeholder={t("onboarding.takenFromAddress")}
                  onChange={(e) => setSetup({ name: e.target.value, source })}
                />
              </label>

              {problem && (
                <p className="field-problem" id="ob-url-problem" role="alert">
                  {t(problem)}
                </p>
              )}

              <div className="setup-actions">
                <button
                  type="button"
                  className="btn primary filled wide"
                  onClick={submit}
                  disabled={!sourceDisplay(source).trim()}
                >
                  {t("common.addPlaylist")}
                </button>
              </div>
            </div>
          )}
        </section>

        <KeyGuide
          className="onboard-foot ruled"
          items={[
            { keys: ["\u2191", "\u2193"], label: t("common.move") },
            { keys: ["OK"], label: t("guide.addIt") },
            { keys: ["Return"], label: t("common.closeApp") },
          ]}
        />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { normalizeRelayUrl } from "../services/remoteRelay";
import type { MessageKey } from "../services/locale";
import { InputShield } from "./InputShield";

export function RelayConfiguration({ value, onSave }: {
  value: string;
  onSave: (url: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<MessageKey | "">("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (saved && !saving) save.current?.focus(); }, [saved, saving]);

  return (
    <form className="form remote-relay-config" noValidate onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      setProblem(""); setSaved(false);
      let url = "";
      try { url = draft.trim() ? normalizeRelayUrl(draft) : ""; }
      catch { setProblem("remote.relayInvalid"); input.current?.focus(); return; }
      setSaving(true);
      try {
        await onSave(url);
        setDraft(url); setSaved(true);
      } catch { setProblem("remote.relayStorage"); input.current?.focus(); }
      finally { setSaving(false); }
    }}>
      <label htmlFor="remote-relay-url">{t("remote.relayUrl")}</label>
      <p id="remote-relay-help" className="sheet-lead">{t("remote.relayHint")}</p>
      <InputShield id="remote-relay-url" ref={input} type="url" inputMode="url"
        dir="ltr" autoComplete="off" spellCheck={false} value={draft}
        aria-describedby="remote-relay-help remote-relay-result" aria-invalid={!!problem}
        onChange={(event) => { setDraft(event.target.value); setSaved(false); setProblem(""); }} />
      <div className="actions">
        <button ref={save} type="submit" className="btn tonal" disabled={saving}>
          {t(saving ? "remote.starting" : "common.save")}
        </button>
      </div>
      <p id="remote-relay-result" className={problem ? "field-problem" : "sheet-lead"}
        role={problem ? "alert" : "status"}>
        {problem ? t(problem) : saved ? t("remote.relaySaved") : ""}
      </p>
    </form>
  );
}

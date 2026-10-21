import { useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal, X } from "lucide-react";
import type { Thresholds } from "../domain/types";

export function ThresholdDialog({
  value,
  onSave,
  onClose,
}: {
  value: Thresholds;
  onSave: (value: Thresholds) => void;
  onClose: () => void;
}) {
  const [t1, setT1] = useState(String(value.t1));
  const [t2, setT2] = useState(String(value.t2));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const valid =
    t1.trim() !== "" &&
    t2.trim() !== "" &&
    Number.isFinite(Number(t1)) &&
    Number.isFinite(Number(t2)) &&
    Number(t1) > 0 &&
    Number(t2) > Number(t1) &&
    Number(t2) <= 10;
  return (
    <dialog
      aria-labelledby="threshold-title"
      ref={dialog}
      className="threshold-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            onSave({ t1: Number(t1), t2: Number(t2) });
            onClose();
          }
        }}
      >
        <div className="dialog-title">
          <span className="dialog-icon">
            <SlidersHorizontal size={22} />
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close threshold settings"
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="threshold-title">Make safety your own.</h2>
        <p>
          Set the acceleration levels that trigger impact alerts. Changes apply
          to the live simulation immediately.
        </p>
        <label className="threshold-input">
          <span>
            <i className="warning-dot" />
            T1 · Warning threshold
          </span>
          <div>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="9.9"
              value={t1}
              onChange={(e) => setT1(e.target.value)}
              autoFocus
              required
              aria-label="T1 warning threshold"
            />
            <span>g</span>
          </div>
        </label>
        <label className="threshold-input">
          <span>
            <i className="critical-dot" />
            T2 · Critical threshold
          </span>
          <div>
            <input
              type="number"
              step="0.1"
              min="0.2"
              max="10"
              value={t2}
              onChange={(e) => setT2(e.target.value)}
              required
              aria-label="T2 critical threshold"
            />
            <span>g</span>
          </div>
        </label>
        {!valid && (
          <p className="form-error" role="alert">
            Use 0 &lt; T1 &lt; T2 ≤ 10 g.
          </p>
        )}
        <div className="threshold-explanation">
          Alerts use the resultant of all three acceleration axes, with gravity
          removed. Values at T1 trigger warning; values at T2 trigger critical.
        </div>
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={!valid}>
            <Check size={16} />
            Save thresholds
          </button>
        </div>
      </form>
    </dialog>
  );
}

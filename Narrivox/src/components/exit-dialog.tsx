import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { pushBackLayer } from "@/lib/back-stack";
import { backgroundNativeApp } from "@/lib/android-back";
import { setSkipExitConfirm } from "@/lib/interface-settings";

export function ExitDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    if (open) setSkip(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return pushBackLayer(() => onOpenChange(false));
  }, [open, onOpenChange]);

  function closeApp() {
    if (skip) setSkipExitConfirm(true);
    backgroundNativeApp();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog-panel">
          <Dialog.Title className="font-display text-2xl">Close Narrivox?</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted">
            This leaves the app. A story that is playing will stop.
          </Dialog.Description>
          <label className="mt-4 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={skip}
              onChange={(event) => setSkip(event.target.checked)}
            />
            Don't show this again
          </label>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => onOpenChange(false)}>
              Stay
            </button>
            <button type="button" className="btn btn-primary" onClick={closeApp}>
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

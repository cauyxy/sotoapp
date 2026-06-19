import { useSyncExternalStore } from "react";

import { peekToasts, subscribeToasts } from "./toast";

export function ToastHost(): JSX.Element {
  const items = useSyncExternalStore(subscribeToasts, peekToasts, peekToasts);
  return (
    <div className="toast-host" role="status" aria-live="polite" aria-atomic>
      {items.map((item) => (
        <div className="toast" key={item.id}>
          {item.text}
        </div>
      ))}
    </div>
  );
}

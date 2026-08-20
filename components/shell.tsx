"use client";

import { Text } from "@radix-ui/themes";
import { type ReactNode, useState } from "react";
import { Toasts } from "./toast";
import styles from "./shell.module.css";

export function Shell({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div className={styles.shell} data-open={open}>
      <nav className={styles.rail}>
        <div className={styles.railTop}>
          {open && (
            // Deliberately not a brand colour. Red on this page means late, and only that.
            <Text size="1" weight="medium" className={styles.wordmark}>
              CareOS
            </Text>
          )}
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() => setOpen(!open)}
          >
            <span className={styles.toggleIcon} aria-hidden />
          </button>
        </div>

        {open && rail}
      </nav>

      <main className={styles.main}>{children}</main>
      <Toasts />
    </div>
  );
}

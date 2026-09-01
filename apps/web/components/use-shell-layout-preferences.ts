"use client";

import { useEffect, useState } from "react";
import { readBrowserStorageItem, writeBrowserStorageItem } from "@/lib/client/storage-port";

const PRIMARY_SIDEBAR_KEY = "af.sidebar.collapsed";
const SECONDARY_SIDEBAR_KEY = "af.sidebar.secondary.collapsed";

export function useShellLayoutPreferences() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSidebarCollapsed(readBrowserStorageItem("local", PRIMARY_SIDEBAR_KEY) === "1");
      setSecondaryCollapsed(readBrowserStorageItem("local", SECONDARY_SIDEBAR_KEY) === "1");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      writeBrowserStorageItem("local", PRIMARY_SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }

  function toggleSecondary() {
    setSecondaryCollapsed((current) => {
      const next = !current;
      writeBrowserStorageItem("local", SECONDARY_SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }

  return {
    sidebarCollapsed,
    secondaryCollapsed,
    toggleSidebar,
    toggleSecondary,
  };
}

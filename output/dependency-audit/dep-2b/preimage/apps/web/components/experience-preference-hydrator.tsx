"use client";

import { useEffect } from "react";
import { applyExperiencePreferences, loadExperiencePreferences } from "@/lib/client/experience-preferences";

export function ExperiencePreferenceHydrator() {
  useEffect(() => {
    applyExperiencePreferences(loadExperiencePreferences());
  }, []);
  return null;
}

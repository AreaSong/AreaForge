import { redirect } from "next/navigation";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings");

export default function SettingsIndexPage() {
  redirect("/settings/exams");
}

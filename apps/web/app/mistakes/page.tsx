import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyMistakesRedirect() {
  redirect("/knowledge/mistakes");
}

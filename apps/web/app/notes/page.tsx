import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyNotesRedirect() {
  redirect("/knowledge/notes");
}

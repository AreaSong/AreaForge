import { NoteCard } from "@/components/note-card";
import type { NoteDto } from "@/lib/contracts";

export function NoteLibraryItem(props: {
  note: NoteDto;
  uploading: boolean;
  uploadError: string | null;
  onUpload: (file: File | undefined) => void;
}) {
  return <NoteCard {...props} />;
}


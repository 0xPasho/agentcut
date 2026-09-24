import { permanentRedirect } from "next/navigation";

/** Subjects are glossary terms with a look (decision 132); the old address lands on the glossary. */
export default function SubjectsPage() {
  permanentRedirect("/settings/glossary?show=subjects");
}

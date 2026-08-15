import { ALL_HELP_SLUGS } from "@/lib/help/generated-content";
import { HelpArticleClient } from "./help-article-client";

export function generateStaticParams() {
  return ALL_HELP_SLUGS.map((slug) => ({ slug }));
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <HelpArticleClient slug={slug} />;
}

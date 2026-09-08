import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GUIDE_SLUGS_BY_LOCALE } from "@/lib/guide/generated-content";
import { getGuideArticle } from "@/lib/guide/guide-service";
import { GuideArticleLayout } from "@/components/guide/article-layout";

export const dynamic = "force-static";

export function generateStaticParams() {
  const slugs = GUIDE_SLUGS_BY_LOCALE["en"] ?? [];
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getGuideArticle("en", slug);
  if (!article) return { title: "Guide — DuoBalance" };

  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://duobalanceapp.com";
  const url = `${base}/guide/${slug}`;
  const title = `${article.frontmatter.title} — DuoBalance`;
  const description = article.frontmatter.description;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "article",
      siteName: "DuoBalance",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function GuideArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = getGuideArticle("en", slug);
  if (!article) notFound();

  return <GuideArticleLayout article={article} backHref="/" backLabel="Back to home" />;
}

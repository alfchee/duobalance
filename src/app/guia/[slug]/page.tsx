import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GUIDE_SLUGS_BY_LOCALE } from "@/lib/guide/generated-content";
import { getGuideArticle } from "@/lib/guide/guide-service";
import { GuideArticleLayout } from "@/components/guide/article-layout";

export const dynamic = "force-static";

export function generateStaticParams() {
  const slugs = GUIDE_SLUGS_BY_LOCALE["es"] ?? [];
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getGuideArticle("es", slug);
  if (!article) return { title: "Guía — DuoBalance" };

  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://duobalanceapp.com";
  const url = `${base}/guia/${slug}`;
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
      locale: "es_NI",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function GuiaArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = getGuideArticle("es", slug);
  if (!article) notFound();

  return (
    <GuideArticleLayout article={article} backHref="/" backLabel="Volver al inicio" locale="es" />
  );
}

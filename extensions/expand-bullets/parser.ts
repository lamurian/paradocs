/**
 * Parser helpers for expand-bullets: extract bullet points and build search queries.
 */

export interface BulletInfo {
  /** The raw bullet text (without leading "- ") */
  text: string;
  /** Section context: the heading or block this bullet belongs to */
  context: string;
}

/**
 * Parse frontmatter from a markdown file, return { tags, title, body }.
 */
export function parseFrontmatter(content: string): {
  tags: string[];
  title?: string;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { tags: [], body: content };

  const tags: string[] = [];
  for (const line of match[1].split("\n")) {
    const li = line.match(/^\s*-\s+(.+)/);
    if (li) tags.push(li[1].trim());
  }

  const titleMatch = match[1].match(/^title:\s*(.*)/m);
  const title = titleMatch ? titleMatch[1].trim() : undefined;
  const body = content.slice(match[0].length).trim();

  return { tags, title, body };
}

/**
 * Extract bullet points from the document body, grouping them by the nearest
 * preceding heading (## or ### line) as context.
 */
export function extractBullets(body: string): BulletInfo[] {
  const lines = body.split("\n");
  const bullets: BulletInfo[] = [];
  let currentHeading = "";

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)/);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+)/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text.startsWith("[") || text.startsWith("http") || text.startsWith("@")) continue;
      if (text.length > 200) continue;
      bullets.push({ text, context: currentHeading });
    }
  }
  return bullets;
}

/**
 * Build a search query from a bullet point and its section context.
 */
export function buildSearchQuery(bullet: BulletInfo): string {
  const parts = [bullet.text];
  if (bullet.context) parts.push(bullet.context);
  return `(site:edu OR site:ac.* OR site:gov) ${parts.join(" ")}`;
}

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import BlogPost from '../models/BlogPost.js';
import FAQItem from '../models/FAQItem.js';

// Lightweight slugify (duplicate of route helper)
function slugify(str){
  return (str||'')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .substring(0,120);
}

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/geo_project';

// --- Static Source Content (from original pages) ---
const seedBlogPosts = [
  {
    title: "The AI-First Future: Why Traditional SEO Alone Won't Cut It Anymore",
    excerpt: "As AI assistants become the primary discovery mechanism, businesses face a fundamental shift in visibility strategy.",
    content: "# The AI-First Future\n\nTraditional SEO is necessary but no longer sufficient. Users now *ask* assistants instead of scanning results.\n\n## Core Shifts\n- Conversational intent parsing\n- Entity-level trust vs keyword density\n- Structured data as a prerequisite, not an enhancement\n\n## What To Do Next\n1. Map entity graph\n2. Fix crawl barriers\n3. Add high-signal structured data\n4. Monitor assistant answer gaps\n\n> Adapt early: recommendation systems compound advantages.",
    category: 'ai-visibility', author: 'Sarah Johnson', readTime: '8 min', featured: true, published: true
  },
  {
    title: 'How We Helped TechStart Achieve 300% More AI Recommendations: A Deep Dive',
    excerpt: 'A structured remediation and semantic alignment project turned invisibility into measurable assistant inclusion.',
    content: '## TechStart Case Study\n\n### Baseline\nMinimal schema, fragmented FAQ content, blocked docs directory.\n\n### Actions\n- Consolidated canonical entities\n- Implemented FAQ & HowTo schema\n- Fixed sitemap/robots conflicts\n\n### Results\n300% increase in assistant recommendation mentions.',
    category: 'case-studies', author: 'Michael Chen', readTime: '12 min', featured: false, published: true
  },
  {
    title: 'The Hidden Factors That Make AI Trust Your Content',
    excerpt: 'AI weighting systems reward consistent entity clarity, provenance signals, and structured intent answers.',
    content: '### Trust Factors\n1. Consistent org/entity graph\n2. Fresh structured snapshots\n3. Factual compression quality\n4. External citation parity',
    category: 'strategies', author: 'Lisa Rodriguez', readTime: '10 min', featured: false, published: true
  },
  {
    title: 'ChatGPT vs. Google: The New Discovery Paradigm',
    excerpt: 'Query → Answer vs. Query → List: the UX shift changes optimization priorities.',
    content: '### Paradigm Notes\nAssistants synthesize *one* answer. Compete for answer slots, not rank positions.\n\n### Optimization Delta\n- Structure > formatting\n- Disambiguation > synonym stuffing',
    category: 'industry-insights', author: 'David Kim', readTime: '9 min', featured: false, published: true
  },
  {
    title: 'AI Visibility vs. SEO: Understanding the Differences',
    excerpt: 'Overlap exists—but assistant surfacing logic is narrower, semantic, intent-first.',
    content: '### Comparison Table\nSEO: crawl + index + rank.\nAI Visibility: parse + embed + trust + recommend.\n\n### Tactical Shift\nFocus on *unified* structured coverage & answer compression.',
    category: 'ai-visibility', author: 'Sarah Johnson', readTime: '11 min', featured: false, published: true
  },
  {
    title: 'The Rise of AI-First Marketing: Early Adopter Lessons',
    excerpt: 'Organizations building assistant-ready taxonomies now are accelerating compounding visibility.',
    content: 'Key lesson: treat assistant answers as a new distribution channel; prototype answerability audits monthly.',
    category: 'industry-insights', author: 'Michael Chen', readTime: '7 min', featured: false, published: true
  },
  {
    title: 'Content Optimization for AI Assistants: A Technical Deep Dive',
    excerpt: 'How semantic chunking, structured hints, and entity graphs influence retrieval.',
    content: '### Technical Stack\n- Structured summaries\n- Canonical entity mapping\n- Intent clustering\n- Schema coverage diffing',
    category: 'strategies', author: 'Lisa Rodriguez', readTime: '13 min', featured: false, published: true
  },
  {
    title: 'Local Restaurant: 150% Orders via AI Visibility',
    excerpt: 'Practical local schema + menu structuring yielded measurable conversions.',
    content: '### Tactics\n- Menu item schema\n- Location disambiguation\n- FAQ for ordering flow',
    category: 'case-studies', author: 'David Kim', readTime: '9 min', featured: false, published: true
  },
  {
    title: 'The Psychology of AI Recommendations',
    excerpt: 'Why perceived neutrality + speed boosts user trust over list-based search.',
    content: 'Key signals: authority narrative consistency + low contradiction across surfaces.',
    category: 'industry-insights', author: 'Sarah Johnson', readTime: '8 min', featured: false, published: true
  },
  {
    title: 'Building Authority in the AI Era: Strategies That Work',
    excerpt: 'Authority = verifiable, current, coherent, referenced. Here is the playbook.',
    content: '### Playbook\n1. Reference calibration\n2. Structured freshness pings\n3. Answer gap harvesting',
    category: 'strategies', author: 'Michael Chen', readTime: '10 min', featured: false, published: true
  }
];

const seedFaqs = [
  { question: 'What is AI visibility?', answer: 'It is how discoverable and parsable your business information is to AI assistants and LLM-driven systems.', category: 'AI Basics', order: 1, published: true },
  { question: 'How is AI visibility different from SEO?', answer: 'SEO targets ranking lists; AI visibility targets inclusion in synthesized assistant answers and recommendations.', category: 'AI Basics', order: 2, published: true },
  { question: 'Why does structured data matter?', answer: 'Schema clarifies entities and intent, reducing hallucination risk and boosting answer eligibility.', category: 'Technical', order: 3, published: true },
  { question: 'Do I need ongoing optimization?', answer: 'Yes. Assistant models and retrieval heuristics evolve—stale data loses inclusion priority.', category: 'Services', order: 4, published: true },
  { question: 'How fast can I see results?', answer: 'Technical fixes can influence assistant retrieval within weeks; authority accrues over months.', category: 'Results', order: 5, published: true },
  { question: 'What industries benefit most?', answer: 'Any with informational queries: SaaS, healthcare, local services, education, finance.', category: 'Implementation', order: 6, published: true },
  { question: 'Is this replacing SEO?', answer: 'No—AI visibility complements and future-proofs traditional organic strategy.', category: 'AI Basics', order: 7, published: true },
  { question: 'What data do you audit?', answer: 'Structured data coverage, crawlability, entity graph coherence, answer gap surfaces.', category: 'Technical', order: 8, published: true },
  { question: 'How is pricing determined?', answer: 'Based on site scale, update cadence, and answer surface complexity.', category: 'Pricing', order: 9, published: true },
  { question: 'Do you support multi-language sites?', answer: 'Yes—consistent entity alignment across locales is part of advanced plans.', category: 'Implementation', order: 10, published: true }
];

async function run(){
  await mongoose.connect('mongodb+srv://new:123.@cluster0.pkemizf.mongodb.net/webdata', { dbName: process.env.DB_NAME || undefined });
  console.log('Connected to Mongo', MONGO_URI);

  // BLOG POSTS
  for(const post of seedBlogPosts){
    const slug = slugify(post.title);
    const exists = await BlogPost.findOne({ slug });
    if(exists){
      console.log('Skipping existing blog:', slug);
      continue;
    }
    // If featured true, unset others
    if(post.featured){ await BlogPost.updateMany({ featured: true }, { $set: { featured: false } }); }
    await BlogPost.create({ ...post, slug });
    console.log('Inserted blog:', slug);
  }

  // FAQS
  for(const faq of seedFaqs){
    const exists = await FAQItem.findOne({ question: faq.question });
    if(exists){
      console.log('Skipping existing FAQ:', faq.question);
      continue;
    }
    await FAQItem.create(faq);
    console.log('Inserted FAQ:', faq.question);
  }

  console.log('Seeding complete');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(e=>{ console.error(e); process.exit(1); });

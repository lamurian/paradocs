/**
 * BM25 semantic search and markdown link appending for batch-created documents.
 *
 * Re-exports from common/autoLink for shared use across extensions.
 * The core logic lives in common/autoLink.ts to avoid duplication between
 * create_para_doc and batch_create_para_docs tool implementations.
 */

export { findRelated, appendLinks } from "../../common/autoLink.js";

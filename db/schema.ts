import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  objectKey: text('object_key').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  status: text('status', { enum: ['processing', 'ready', 'failed'] }).notNull(),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('idx_documents_user_uploaded').on(table.userId, table.uploadedAt)]);

export const documentChunks = sqliteTable('document_chunks', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  content: text('content').notNull(),
}, (table) => [index('idx_chunks_document_position').on(table.documentId, table.position)]);

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  sourceDocumentIds: text('source_document_ids').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('idx_chats_user_created').on(table.userId, table.createdAt)]);

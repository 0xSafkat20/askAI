CREATE TABLE `users` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL, `name` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE `documents` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `filename` text NOT NULL, `object_key` text NOT NULL, `content_type` text NOT NULL, `size` integer NOT NULL, `status` text NOT NULL, `uploaded_at` integer NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE INDEX `idx_documents_user_uploaded` ON `documents` (`user_id`,`uploaded_at`);
--> statement-breakpoint
CREATE TABLE `document_chunks` (`id` text PRIMARY KEY NOT NULL, `document_id` text NOT NULL, `position` integer NOT NULL, `content` text NOT NULL, FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE INDEX `idx_chunks_document_position` ON `document_chunks` (`document_id`,`position`);
--> statement-breakpoint
CREATE TABLE `chats` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `question` text NOT NULL, `answer` text NOT NULL, `source_document_ids` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE INDEX `idx_chats_user_created` ON `chats` (`user_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;

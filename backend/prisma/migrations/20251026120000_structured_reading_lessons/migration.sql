-- CreateEnum
CREATE TYPE "ReadingResourceKind" AS ENUM ('PDF', 'EXTERNAL_LINK', 'EMBED');

-- AlterTable
ALTER TABLE "module_contents" ADD COLUMN     "reading_objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reading_published_at" TIMESTAMP(3),
ADD COLUMN     "reading_references" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reading_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "content_progress" ADD COLUMN     "last_pdf_page" INTEGER,
ADD COLUMN     "last_section_id" UUID,
ADD COLUMN     "last_section_index" INTEGER,
ADD COLUMN     "reading_completed_version" INTEGER,
ADD COLUMN     "reading_sections_done" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "reading_sections" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "estimated_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_checkpoints" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT,
    "passing_score" INTEGER NOT NULL DEFAULT 100,
    "max_attempts" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_checkpoint_questions" (
    "id" UUID NOT NULL,
    "checkpoint_id" UUID NOT NULL,
    "type" "QuestionType" NOT NULL DEFAULT 'SINGLE_CHOICE',
    "prompt" TEXT NOT NULL,
    "explanation" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_checkpoint_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_checkpoint_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "reading_checkpoint_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_section_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "checkpoint_passed" BOOLEAN,
    "checkpoint_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_section_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_checkpoint_submissions" (
    "id" UUID NOT NULL,
    "checkpoint_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "max_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_checkpoint_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_resources" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "kind" "ReadingResourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "storage_path" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "order_index" INTEGER NOT NULL,
    "is_downloadable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reading_sections_content_id_order_index_idx" ON "reading_sections"("content_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "reading_checkpoints_section_id_key" ON "reading_checkpoints"("section_id");

-- CreateIndex
CREATE INDEX "reading_checkpoints_content_id_idx" ON "reading_checkpoints"("content_id");

-- CreateIndex
CREATE INDEX "reading_checkpoint_questions_checkpoint_id_order_index_idx" ON "reading_checkpoint_questions"("checkpoint_id", "order_index");

-- CreateIndex
CREATE INDEX "reading_checkpoint_options_question_id_order_index_idx" ON "reading_checkpoint_options"("question_id", "order_index");

-- CreateIndex
CREATE INDEX "reading_section_progress_attempt_id_content_id_idx" ON "reading_section_progress"("attempt_id", "content_id");

-- CreateIndex
CREATE INDEX "reading_section_progress_user_id_idx" ON "reading_section_progress"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reading_section_progress_attempt_id_section_id_key" ON "reading_section_progress"("attempt_id", "section_id");

-- CreateIndex
CREATE INDEX "reading_checkpoint_submissions_attempt_id_idx" ON "reading_checkpoint_submissions"("attempt_id");

-- CreateIndex
CREATE INDEX "reading_checkpoint_submissions_checkpoint_id_passed_idx" ON "reading_checkpoint_submissions"("checkpoint_id", "passed");

-- CreateIndex
CREATE UNIQUE INDEX "reading_checkpoint_submissions_checkpoint_id_attempt_id_att_key" ON "reading_checkpoint_submissions"("checkpoint_id", "attempt_id", "attempt_number");

-- CreateIndex
CREATE INDEX "reading_resources_content_id_order_index_idx" ON "reading_resources"("content_id", "order_index");

-- AddForeignKey
ALTER TABLE "reading_sections" ADD CONSTRAINT "reading_sections_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "module_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_checkpoints" ADD CONSTRAINT "reading_checkpoints_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "reading_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_checkpoint_questions" ADD CONSTRAINT "reading_checkpoint_questions_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "reading_checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_checkpoint_options" ADD CONSTRAINT "reading_checkpoint_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "reading_checkpoint_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_section_progress" ADD CONSTRAINT "reading_section_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_section_progress" ADD CONSTRAINT "reading_section_progress_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "course_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_section_progress" ADD CONSTRAINT "reading_section_progress_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "reading_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_checkpoint_submissions" ADD CONSTRAINT "reading_checkpoint_submissions_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "reading_checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_checkpoint_submissions" ADD CONSTRAINT "reading_checkpoint_submissions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "course_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_checkpoint_submissions" ADD CONSTRAINT "reading_checkpoint_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_resources" ADD CONSTRAINT "reading_resources_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "module_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bahasa caption sosial per job ('auto' | 'id' | 'en'); job lama memakai 'auto'.
ALTER TABLE "jobs" ADD COLUMN "captionLanguage" TEXT NOT NULL DEFAULT 'auto';

-- Cuplikan transkrip per klip (≤ 2000 karakter) untuk regenerasi caption; klip lama NULL.
ALTER TABLE "clips" ADD COLUMN "transcript" TEXT;

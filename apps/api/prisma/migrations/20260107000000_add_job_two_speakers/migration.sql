-- Tata letak dua pembicara (panel atas/bawah). Default false untuk job lama.
ALTER TABLE "jobs" ADD COLUMN "twoSpeakers" BOOLEAN NOT NULL DEFAULT false;

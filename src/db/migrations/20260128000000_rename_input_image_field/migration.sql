-- Rename inputImageUrl to inputImage and change to TEXT type for base64 data
ALTER TABLE "Job" RENAME COLUMN "inputImageUrl" TO "inputImage";
ALTER TABLE "Job" ALTER COLUMN "inputImage" TYPE TEXT;

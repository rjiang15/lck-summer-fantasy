-- DropForeignKey
ALTER TABLE "CrystalBallAnswer" DROP CONSTRAINT "CrystalBallAnswer_questionId_fkey";

-- AddForeignKey
ALTER TABLE "CrystalBallAnswer" ADD CONSTRAINT "CrystalBallAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CrystalBallQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

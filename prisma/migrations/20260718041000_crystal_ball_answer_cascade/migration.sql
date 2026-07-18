-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CrystalBallAnswer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrystalBallAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CrystalBallQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CrystalBallAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CrystalBallAnswer" ("answer", "createdAt", "id", "questionId", "updatedAt", "userId") SELECT "answer", "createdAt", "id", "questionId", "updatedAt", "userId" FROM "CrystalBallAnswer";
DROP TABLE "CrystalBallAnswer";
ALTER TABLE "new_CrystalBallAnswer" RENAME TO "CrystalBallAnswer";
CREATE UNIQUE INDEX "CrystalBallAnswer_questionId_userId_key" ON "CrystalBallAnswer"("questionId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

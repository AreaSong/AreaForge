CREATE TABLE "AiRuntimeSetting" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRuntimeSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AiRuntimeSetting" ("id", "enabled", "revision", "createdAt", "updatedAt")
VALUES ('global', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

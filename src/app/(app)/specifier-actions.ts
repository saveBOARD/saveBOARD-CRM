"use server";

import { refresh } from "next/cache";
import { isUuid } from "@/lib/ids";
import { SPECIFIER_STAGES, type SpecifierStage } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { setSpecifierStage } from "@/server/crm/specifiers";

/** Move a contact along the specifier track, put them on it ("visited"), or take them off it ("none"). */
export async function setSpecifierStageAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = form.get("contact_id");
  const stage = String(form.get("stage") ?? "");
  if (!isUuid(id)) return;
  if (stage !== "none" && !(stage in SPECIFIER_STAGES)) return;
  await setSpecifierStage({ type: "user", profileId: user.id }, id, stage === "none" ? null : (stage as SpecifierStage));
  refresh();
}

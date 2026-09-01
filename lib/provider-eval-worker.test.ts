import { describe, expect, it } from "vitest";
import { APPLY_EVAL_SCORES_RPC, EVAL_INPUTS_RPC, runProviderEvalRecompute } from "@/lib/provider-eval-worker";
import { PROVIDER_EVAL_METHOD_VERSION } from "@/lib/provider-eval";

interface Call { name: string; args: Record<string, unknown> }

function fakeClient(
  calls: Call[],
  opts: { inputs?: unknown; applied?: unknown; inputsError?: string; applyError?: string } = {},
) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === EVAL_INPUTS_RPC) {
        return Promise.resolve({
          data: opts.inputs ?? [],
          error: opts.inputsError ? { message: opts.inputsError } : null,
        });
      }
      return Promise.resolve({
        data: opts.applied ?? { written: 0, starsPublished: 0, heldBack: 0 },
        error: opts.applyError ? { message: opts.applyError } : null,
      });
    },
  };
}

const provenTeam = {
  teamId: "proven", teamName: "ทีมพิสูจน์แล้ว", providerType: "subcontract", isActive: true,
  jobCount: 40, csatSum: 4.5 * 30, csatCount: 30, ncrWeighted: 2, ncrCount: 3,
  onTimeBase: 35, onTimeCount: 33, firstPassBase: 20, firstPassCount: 17,
};

describe("รอบคำนวณคะแนนผู้ให้บริการ", () => {
  it("ระบบว่างเปล่า: ไม่มีทีมเลย -> ไม่เขียนอะไร และไม่ถือเป็นความผิดพลาด", async () => {
    const calls: Call[] = [];
    const summary = await runProviderEvalRecompute(fakeClient(calls, { inputs: [] }));
    expect(calls.map((call) => call.name)).toEqual([EVAL_INPUTS_RPC]);
    expect(summary).toMatchObject({ teamsRead: 0, teamsScored: 0, starsPublished: 0, heldBack: 0 });
    expect(summary.methodVersion).toBe(PROVIDER_EVAL_METHOD_VERSION);
  });

  it("มีทีมแต่ยังไม่มีข้อมูลสักด้าน: เขียนแถวไว้ ไม่ประกาศดาว และบอกชื่อทีมที่ยังเงียบ", async () => {
    const calls: Call[] = [];
    const summary = await runProviderEvalRecompute(fakeClient(calls, {
      inputs: [{ teamId: "t1", teamName: "ทีมใหม่", jobCount: 0 }],
      applied: { written: 1, starsPublished: 0, heldBack: 1 },
    }));
    expect(calls.map((call) => call.name)).toEqual([EVAL_INPUTS_RPC, APPLY_EVAL_SCORES_RPC]);
    const payload = (calls[1].args.p_scores as Record<string, unknown>[])[0];
    expect(payload).toMatchObject({ teamId: "t1", hasData: false, evalScore: null, evalAvg: null, isProvisional: true });
    expect(summary.teamsWithoutData).toEqual(["ทีมใหม่"]);
    expect(summary.starsPublished).toBe(0);
  });

  it("มีข้อมูลจริง: ส่งคะแนนย่อยครบทุกด้านไปกับ payload", async () => {
    const calls: Call[] = [];
    await runProviderEvalRecompute(fakeClient(calls, {
      inputs: [provenTeam],
      applied: { written: 1, starsPublished: 1, heldBack: 0 },
    }));
    const payload = (calls[1].args.p_scores as Record<string, unknown>[])[0];
    expect(payload.hasData).toBe(true);
    expect(payload.isProvisional).toBe(false);
    expect(payload.csatSample).toBe(30);
    expect(payload.onTimeSample).toBe(35);
    expect(payload.ftpSample).toBe(20);
    expect(payload.ncrCount).toBe(3);
    expect(payload.directEvidence).toBe(85);
    expect(Number(payload.evalAvg)).toBeLessThanOrEqual(5);
    expect(Number(payload.evalScore)).toBeLessThanOrEqual(Number(payload.performanceScore));
  });

  it("รันซ้ำด้วยข้อมูลเดิมได้ payload เดิมเป๊ะ — ปลอดภัยที่จะยิงซ้ำ", async () => {
    const first: Call[] = [];
    const second: Call[] = [];
    await runProviderEvalRecompute(fakeClient(first, { inputs: [provenTeam] }));
    await runProviderEvalRecompute(fakeClient(second, { inputs: [provenTeam] }));
    expect(second[1].args.p_scores).toEqual(first[1].args.p_scores);
  });

  it("อ่านตัวเลขตั้งต้นไม่ได้ ต้องหยุดทันที ไม่เขียนคะแนนมั่ว", async () => {
    const calls: Call[] = [];
    await expect(runProviderEvalRecompute(fakeClient(calls, { inputsError: "permission denied" })))
      .rejects.toThrow("permission denied");
    expect(calls.map((call) => call.name)).toEqual([EVAL_INPUTS_RPC]);
  });

  it("เขียนผลไม่สำเร็จ ต้องโยนข้อความจากฐานข้อมูลออกมาตรง ๆ", async () => {
    const calls: Call[] = [];
    await expect(runProviderEvalRecompute(fakeClient(calls, { inputs: [provenTeam], applyError: "ไม่พบทีมช่างรหัส x" })))
      .rejects.toThrow("ไม่พบทีมช่างรหัส x");
  });
});

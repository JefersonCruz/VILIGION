import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { hashAddress, SignupService } from "./signup-service.js";
import { PhoneMappingService } from "./phone-mapping.js";

const ADDR = "0x0000000000000000000000000000000000dEaD" as Address;

describe("hashAddress", () => {
  it("é determinístico e normaliza maiúsculas/minúsculas", () => {
    const upper = hashAddress("0xABCDEF0000000000000000000000000000dEaD" as Address);
    const lower = hashAddress("0xabcdef0000000000000000000000000000dead" as Address);
    expect(upper).toBe(lower);
    expect(upper).toHaveLength(64); // sha256 hex
  });
});

describe("SignupService", () => {
  function buildService(options: { ownershipValid: boolean; usernameTaken?: boolean }) {
    const phoneMappingService = {
      register: options.ownershipValid
        ? vi.fn().mockResolvedValue({
            encryptedDataKey: Buffer.from("k"),
            iv: Buffer.from("i"),
            authTag: Buffer.from("t"),
            ciphertext: Buffer.from("c"),
          })
        : vi.fn().mockRejectedValue(new Error("Assinatura não corresponde ao endereço informado")),
    } as unknown as PhoneMappingService;

    const phoneMappingRepo = { save: vi.fn().mockResolvedValue("user-1") } as any;
    const dashboardUsers = {
      findByUsername: vi.fn().mockResolvedValue(options.usernameTaken ? { userId: "outro" } : null),
      create: vi.fn().mockResolvedValue(undefined),
    } as any;
    const thresholds = { upsert: vi.fn().mockResolvedValue(undefined) } as any;

    const service = new SignupService(phoneMappingService, phoneMappingRepo, dashboardUsers, thresholds);
    return { service, phoneMappingRepo, dashboardUsers, thresholds };
  }

  it("cadastro completo: cria dashboard_user com o MESMO userId retornado por phone_mappings", async () => {
    const { service, phoneMappingRepo, dashboardUsers, thresholds } = buildService({ ownershipValid: true });

    const result = await service.signup({
      address: ADDR,
      nonce: "n1",
      signature: "0xsig",
      username: "dono",
      password: "senha-forte",
    });

    expect(result.userId).toBe("user-1");
    expect(result.username).toBe("dono");
    expect(result.otpAuthUri).toMatch(/^otpauth:\/\/totp\/VILIGION/);

    expect(phoneMappingRepo.save).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
    expect(dashboardUsers.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", username: "dono" }),
    );
    expect(thresholds.upsert).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }));
  });

  it("recusa cadastro se o username já existir, sem tentar verificar assinatura", async () => {
    const { service, phoneMappingRepo } = buildService({ ownershipValid: true, usernameTaken: true });

    await expect(
      service.signup({
        address: ADDR,
        nonce: "n1",
        signature: "0xsig",
        username: "dono",
        password: "senha-forte",
      }),
    ).rejects.toThrow(/já cadastrado/);

    expect(phoneMappingRepo.save).not.toHaveBeenCalled();
  });

  it("propaga o erro de prova de propriedade sem criar nenhum dado", async () => {
    const { service, phoneMappingRepo, dashboardUsers } = buildService({ ownershipValid: false });

    await expect(
      service.signup({
        address: ADDR,
        nonce: "n1",
        signature: "0xsig-invalida",
        username: "dono",
        password: "senha-forte",
      }),
    ).rejects.toThrow(/Assinatura não corresponde/);

    expect(phoneMappingRepo.save).not.toHaveBeenCalled();
    expect(dashboardUsers.create).not.toHaveBeenCalled();
  });
});

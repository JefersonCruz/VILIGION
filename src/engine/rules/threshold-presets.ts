export interface ThresholdPreset {
  key: string;
  name: string;
  description: string;
  /** % de queda que manda e-mail */
  warnPct: number;
  /** % de queda que liga por telefone */
  critPct: number;
  windowMinutes: number;
  /** transferência bloqueada, em US$ */
  blockedWarnUsd: number;
  blockedCritUsd: number;
}

/** Perfis prontos: atalhos que preenchem os campos. "Personalizado" não é um perfil, é a ausência de correspondência. */
export const THRESHOLD_PRESETS: ThresholdPreset[] = [
  {
    key: "conservador",
    name: "Conservador",
    description: "Avisa cedo. Mais alertas, menos risco de perder algo.",
    warnPct: 5,
    critPct: 20,
    windowMinutes: 60,
    blockedWarnUsd: 500,
    blockedCritUsd: 5000,
  },
  {
    key: "equilibrado",
    name: "Equilibrado",
    description: "Recomendado para a maioria das tesourarias.",
    warnPct: 10,
    critPct: 30,
    windowMinutes: 60,
    blockedWarnUsd: 2000,
    blockedCritUsd: 20000,
  },
  {
    key: "tolerante",
    name: "Tolerante",
    description: "Para valores grandes e movimento frequente. Menos ruído.",
    warnPct: 20,
    critPct: 50,
    windowMinutes: 120,
    blockedWarnUsd: 10000,
    blockedCritUsd: 50000,
  },
];

export const WINDOW_CHOICES_MINUTES = [15, 60, 120, 360, 1440];

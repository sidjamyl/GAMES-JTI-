export interface Prize {
  name: string;
  quantity: number;
  emoji: string;
}

export interface PrizesResponse {
  prizes: Prize[];
}

export interface ClaimPayload {
  prize: string;
  quantity: 1;
}

export type GamePhase = 'loading' | 'ready' | 'playing' | 'victory';

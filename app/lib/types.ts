export interface Prize {
  id: number;
  name: string;
  quantity: number;
  emoji: string;
}

export interface PrizesResponse {
  prizes: Prize[];
}

export interface ClaimPayload {
  id: number;
  quantity: 1;
  gid?: string;
}

export type GamePhase = 'loading' | 'ready' | 'playing' | 'victory';

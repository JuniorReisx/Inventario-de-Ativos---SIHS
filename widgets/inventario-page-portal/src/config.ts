import type { ImmutableObject } from 'seamless-immutable'

export interface Config {
  portalUrl?: string
  webMapId?: string
  oauthAppId?: string
}

export type IMConfig = ImmutableObject<Config>

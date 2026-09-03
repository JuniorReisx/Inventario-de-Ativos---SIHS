import type { ImmutableObject } from 'seamless-immutable'

export interface Config {
  portalUrl?: string
  webMapId?: string
  oauthAppId?: string
  chatApiUrl?: string
}

export type IMConfig = ImmutableObject<Config>

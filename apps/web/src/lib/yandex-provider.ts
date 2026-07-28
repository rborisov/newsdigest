import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers";

export interface YandexProfile {
  id: string;
  login: string;
  default_email?: string;
  emails?: string[];
  display_name?: string;
  real_name?: string;
  default_avatar_id?: string;
}

export default function Yandex(
  options: OAuthUserConfig<YandexProfile>,
): OAuthConfig<YandexProfile> {
  return {
    id: "yandex",
    name: "Yandex",
    type: "oauth",
    authorization: {
      url: "https://oauth.yandex.ru/authorize",
      params: { scope: "login:email login:info" },
    },
    token: "https://oauth.yandex.ru/token",
    userinfo: "https://login.yandex.ru/info?format=json",
    profile(profile) {
      return {
        id: profile.id,
        name: profile.display_name ?? profile.real_name ?? profile.login,
        email: profile.default_email ?? profile.emails?.[0],
        image: profile.default_avatar_id
          ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`
          : undefined,
      };
    },
    options,
  };
}

const URLS = {
  auth: 'https://functions.poehali.dev/de0b1d6d-e8c5-46e9-bba8-7754d55e6a00',
  messages: 'https://functions.poehali.dev/7640fded-e6d0-4d0b-8271-ef6a82c335e5',
  friends: 'https://functions.poehali.dev/ea138c37-cff2-41ed-8d3f-73fdc7db46dc',
  groups: 'https://functions.poehali.dev/f502c223-8847-4f5c-bab4-b92fe7c60591',
};

function getSession() {
  return localStorage.getItem('kiscord_session') || '';
}

async function req(base: keyof typeof URLS, path: string, method = 'GET', body?: object) {
  try {
    const res = await fetch(URLS[base] + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': getSession(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  } catch {
    return { error: 'Нет соединения с сервером' };
  }
}

export const api = {
  auth: {
    register: (data: object) => req('auth', '/register', 'POST', data),
    login: (data: object) => req('auth', '/login', 'POST', data),
    logout: () => req('auth', '/logout', 'POST'),
    me: () => req('auth', '/me'),
    updateProfile: (data: object) => req('auth', '/profile', 'PUT', data),
  },
  friends: {
    list: () => req('friends', '/list'),
    search: (q: string) => req('friends', `/search?q=${encodeURIComponent(q)}`),
    request: (userId: number) => req('friends', '/request', 'POST', { user_id: userId }),
    accept: (userId: number) => req('friends', '/accept', 'POST', { user_id: userId }),
    decline: (userId: number) => req('friends', '/decline', 'POST', { user_id: userId }),
  },
  messages: {
    conversations: () => req('messages', '/conversations'),
    openConversation: (data: object) => req('messages', '/conversations', 'POST', data),
    getMessages: (convId: number) => req('messages', `/messages?conversation_id=${convId}`),
    send: (convId: number, content: string) => req('messages', '/messages', 'POST', { conversation_id: convId, content }),
  },
  groups: {
    list: () => req('groups', '/list'),
    create: (data: object) => req('groups', '/create', 'POST', data),
    members: (groupId: number) => req('groups', `/members?group_id=${groupId}`),
    addMember: (groupId: number, userId: number) => req('groups', '/add-member', 'POST', { group_id: groupId, user_id: userId }),
  },
};
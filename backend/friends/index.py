"""Система друзей Kiscord: поиск, заявки, принятие/отклонение"""
import json
import os
import psycopg2

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def get_user_id(cur, session_id):
    cur.execute("SELECT user_id FROM sessions WHERE id=%s", (session_id,))
    row = cur.fetchone()
    return row[0] if row else None

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    path = event.get('path', '/')
    method = event.get('httpMethod', 'GET')
    body = json.loads(event.get('body') or '{}')
    session_id = event.get('headers', {}).get('x-session-id', '')
    params = event.get('queryStringParameters') or {}

    conn = get_conn()
    cur = conn.cursor()
    user_id = get_user_id(cur, session_id)
    if not user_id:
        return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Не авторизован'})}

    # GET /list — список друзей
    if method == 'GET' and path.endswith('/list'):
        cur.execute("""
            SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, f.status as f_status, f.requester_id
            FROM friendships f
            JOIN users u ON (CASE WHEN f.requester_id=%s THEN f.addressee_id ELSE f.requester_id END)=u.id
            WHERE (f.requester_id=%s OR f.addressee_id=%s)
        """, (user_id, user_id, user_id))
        rows = cur.fetchall()
        friends = [{'id': r[0], 'username': r[1], 'display_name': r[2], 'avatar_color': r[3], 'status': r[4], 'friendship_status': r[5], 'is_requester': r[6] == user_id} for r in rows]
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'friends': friends})}

    # GET /search?q=...
    if method == 'GET' and path.endswith('/search'):
        q = params.get('q', '').strip()
        if not q:
            return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'users': []})}
        cur.execute(
            "SELECT id, username, display_name, avatar_color, status FROM users WHERE (username ILIKE %s OR display_name ILIKE %s) AND id != %s LIMIT 20",
            (f'%{q}%', f'%{q}%', user_id)
        )
        rows = cur.fetchall()
        users = [{'id': r[0], 'username': r[1], 'display_name': r[2], 'avatar_color': r[3], 'status': r[4]} for r in rows]
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'users': users})}

    # POST /request — отправить заявку
    if method == 'POST' and path.endswith('/request'):
        target_id = body.get('user_id')
        if not target_id:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'user_id обязателен'})}
        try:
            cur.execute(
                "INSERT INTO friendships (requester_id, addressee_id, status) VALUES (%s, %s, 'pending') ON CONFLICT DO NOTHING",
                (user_id, target_id)
            )
            conn.commit()
        except Exception:
            conn.rollback()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True})}

    # POST /accept
    if method == 'POST' and path.endswith('/accept'):
        friend_id = body.get('user_id')
        cur.execute(
            "UPDATE friendships SET status='accepted' WHERE requester_id=%s AND addressee_id=%s AND status='pending'",
            (friend_id, user_id)
        )
        conn.commit()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True})}

    # POST /decline
    if method == 'POST' and path.endswith('/decline'):
        friend_id = body.get('user_id')
        cur.execute(
            "UPDATE friendships SET status='declined' WHERE requester_id=%s AND addressee_id=%s",
            (friend_id, user_id)
        )
        conn.commit()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True})}

    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}

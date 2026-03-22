"""Сообщения и диалоги Kiscord"""
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

    # GET /conversations — список диалогов
    if method == 'GET' and path.endswith('/conversations'):
        cur.execute("""
            SELECT c.id, c.type, c.group_id, c.user1_id, c.user2_id,
                   u1.display_name, u1.avatar_color, u1.status,
                   u2.display_name, u2.avatar_color, u2.status,
                   g.name, g.avatar_color,
                   (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg,
                   (SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) as last_time
            FROM conversations c
            LEFT JOIN users u1 ON c.user1_id=u1.id
            LEFT JOIN users u2 ON c.user2_id=u2.id
            LEFT JOIN groups g ON c.group_id=g.id
            WHERE c.user1_id=%s OR c.user2_id=%s
               OR c.group_id IN (SELECT group_id FROM group_members WHERE user_id=%s)
            ORDER BY last_time DESC NULLS LAST
        """, (user_id, user_id, user_id))
        rows = cur.fetchall()
        convs = []
        for r in rows:
            if r[1] == 'direct':
                other_id = r[4] if r[3] == user_id else r[3]
                if r[3] == user_id:
                    name, color, status = r[8], r[9], r[10]
                else:
                    name, color, status = r[5], r[6], r[7]
                convs.append({'id': r[0], 'type': 'direct', 'name': name, 'avatar_color': color, 'other_user_status': status, 'last_message': r[13], 'last_time': str(r[14]) if r[14] else None, 'other_user_id': other_id})
            else:
                convs.append({'id': r[0], 'type': 'group', 'group_id': r[2], 'name': r[11], 'avatar_color': r[12], 'last_message': r[13], 'last_time': str(r[14]) if r[14] else None})
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'conversations': convs})}

    # POST /conversations — создать/найти диалог
    if method == 'POST' and path.endswith('/conversations'):
        target_id = body.get('user_id')
        group_id = body.get('group_id')
        if target_id:
            cur.execute(
                "SELECT id FROM conversations WHERE type='direct' AND ((user1_id=%s AND user2_id=%s) OR (user1_id=%s AND user2_id=%s))",
                (user_id, target_id, target_id, user_id)
            )
            existing = cur.fetchone()
            if existing:
                return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'conversation_id': existing[0]})}
            cur.execute(
                "INSERT INTO conversations (type, user1_id, user2_id) VALUES ('direct', %s, %s) RETURNING id",
                (user_id, target_id)
            )
            conv_id = cur.fetchone()[0]
            conn.commit()
            return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'conversation_id': conv_id})}
        if group_id:
            cur.execute(
                "SELECT id FROM conversations WHERE type='group' AND group_id=%s",
                (group_id,)
            )
            existing = cur.fetchone()
            if existing:
                return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'conversation_id': existing[0]})}
            cur.execute(
                "INSERT INTO conversations (type, group_id) VALUES ('group', %s) RETURNING id",
                (group_id,)
            )
            conv_id = cur.fetchone()[0]
            conn.commit()
            return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'conversation_id': conv_id})}
        return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужен user_id или group_id'})}

    # GET /messages?conversation_id=X
    if method == 'GET' and path.endswith('/messages'):
        conv_id = params.get('conversation_id')
        if not conv_id:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'conversation_id обязателен'})}
        cur.execute("""
            SELECT m.id, m.sender_id, u.display_name, u.avatar_color, m.content, m.created_at
            FROM messages m
            LEFT JOIN users u ON m.sender_id=u.id
            WHERE m.conversation_id=%s
            ORDER BY m.created_at ASC
            LIMIT 100
        """, (conv_id,))
        rows = cur.fetchall()
        msgs = [{'id': r[0], 'sender_id': r[1], 'sender_name': r[2], 'sender_color': r[3], 'content': r[4], 'created_at': str(r[5])} for r in rows]
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'messages': msgs})}

    # POST /messages — отправить сообщение
    if method == 'POST' and path.endswith('/messages'):
        conv_id = body.get('conversation_id')
        content = body.get('content', '').strip()
        if not conv_id or not content:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужны conversation_id и content'})}
        cur.execute(
            "INSERT INTO messages (conversation_id, sender_id, content) VALUES (%s, %s, %s) RETURNING id, created_at",
            (conv_id, user_id, content)
        )
        msg_id, created_at = cur.fetchone()
        conn.commit()
        cur.execute("SELECT display_name, avatar_color FROM users WHERE id=%s", (user_id,))
        u = cur.fetchone()
        return {
            'statusCode': 200, 'headers': CORS,
            'body': json.dumps({'message': {'id': msg_id, 'sender_id': user_id, 'sender_name': u[0], 'sender_color': u[1], 'content': content, 'created_at': str(created_at)}})
        }

    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}

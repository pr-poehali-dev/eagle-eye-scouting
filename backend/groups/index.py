"""Группы Kiscord: создание, управление участниками"""
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

    conn = get_conn()
    cur = conn.cursor()
    user_id = get_user_id(cur, session_id)
    if not user_id:
        return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Не авторизован'})}

    # GET /list
    if method == 'GET' and path.endswith('/list'):
        cur.execute("""
            SELECT g.id, g.name, g.avatar_color, g.owner_id,
                   (SELECT COUNT(*) FROM group_members WHERE group_id=g.id) as member_count
            FROM groups g
            JOIN group_members gm ON g.id=gm.group_id
            WHERE gm.user_id=%s
        """, (user_id,))
        rows = cur.fetchall()
        groups = [{'id': r[0], 'name': r[1], 'avatar_color': r[2], 'owner_id': r[3], 'member_count': r[4]} for r in rows]
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'groups': groups})}

    # POST /create
    if method == 'POST' and path.endswith('/create'):
        name = body.get('name', '').strip()
        member_ids = body.get('member_ids', [])
        if not name:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Название обязательно'})}
        colors = ['#e06c75', '#c678dd', '#61afef', '#98c379', '#e5c07b']
        color = colors[len(name) % len(colors)]
        cur.execute("INSERT INTO groups (name, owner_id, avatar_color) VALUES (%s, %s, %s) RETURNING id", (name, user_id, color))
        group_id = cur.fetchone()[0]
        cur.execute("INSERT INTO group_members (group_id, user_id) VALUES (%s, %s)", (group_id, user_id))
        for mid in member_ids:
            if mid != user_id:
                cur.execute("INSERT INTO group_members (group_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (group_id, mid))
        conn.commit()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'group_id': group_id, 'name': name, 'avatar_color': color})}

    # POST /add-member
    if method == 'POST' and path.endswith('/add-member'):
        group_id = body.get('group_id')
        target_id = body.get('user_id')
        cur.execute("INSERT INTO group_members (group_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (group_id, target_id))
        conn.commit()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True})}

    # GET /members?group_id=X
    if method == 'GET' and '/members' in path:
        params = event.get('queryStringParameters') or {}
        group_id = params.get('group_id')
        cur.execute("""
            SELECT u.id, u.username, u.display_name, u.avatar_color, u.status
            FROM group_members gm JOIN users u ON gm.user_id=u.id
            WHERE gm.group_id=%s
        """, (group_id,))
        rows = cur.fetchall()
        members = [{'id': r[0], 'username': r[1], 'display_name': r[2], 'avatar_color': r[3], 'status': r[4]} for r in rows]
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'members': members})}

    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}

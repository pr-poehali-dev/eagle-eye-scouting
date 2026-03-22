"""Регистрация, вход и выход пользователей Kiscord"""
import json
import os
import hashlib
import secrets
import psycopg2

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id',
}

def get_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    path = event.get('path', '/')
    method = event.get('httpMethod', 'GET')
    body = json.loads(event.get('body') or '{}')
    session_id = event.get('headers', {}).get('x-session-id', '')

    conn = get_conn()
    cur = conn.cursor()

    # POST /register
    if method == 'POST' and path.endswith('/register'):
        username = body.get('username', '').strip().lower()
        display_name = body.get('display_name', '').strip()
        email = body.get('email', '').strip().lower()
        password = body.get('password', '')

        if not all([username, display_name, email, password]):
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Заполните все поля'})}

        colors = ['#e06c75', '#c678dd', '#61afef', '#98c379', '#e5c07b', '#56b6c2']
        color = colors[len(username) % len(colors)]

        try:
            cur.execute(
                "INSERT INTO users (username, display_name, email, password_hash, avatar_color) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (username, display_name, email, hash_password(password), color)
            )
            user_id = cur.fetchone()[0]
            sid = secrets.token_hex(32)
            cur.execute("INSERT INTO sessions (id, user_id) VALUES (%s, %s)", (sid, user_id))
            conn.commit()
            return {
                'statusCode': 200, 'headers': CORS,
                'body': json.dumps({'session_id': sid, 'user': {'id': user_id, 'username': username, 'display_name': display_name, 'avatar_color': color, 'status': 'online'}})
            }
        except psycopg2.errors.UniqueViolation:
            conn.rollback()
            return {'statusCode': 409, 'headers': CORS, 'body': json.dumps({'error': 'Имя пользователя или email уже занят'})}

    # POST /login
    if method == 'POST' and path.endswith('/login'):
        login = body.get('login', '').strip().lower()
        password = body.get('password', '')
        cur.execute(
            "SELECT id, username, display_name, avatar_color FROM users WHERE (username=%s OR email=%s) AND password_hash=%s",
            (login, login, hash_password(password))
        )
        row = cur.fetchone()
        if not row:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Неверный логин или пароль'})}
        user_id, username, display_name, avatar_color = row
        sid = secrets.token_hex(32)
        cur.execute("INSERT INTO sessions (id, user_id) VALUES (%s, %s)", (sid, user_id))
        cur.execute("UPDATE users SET status='online' WHERE id=%s", (user_id,))
        conn.commit()
        return {
            'statusCode': 200, 'headers': CORS,
            'body': json.dumps({'session_id': sid, 'user': {'id': user_id, 'username': username, 'display_name': display_name, 'avatar_color': avatar_color, 'status': 'online'}})
        }

    # POST /logout
    if method == 'POST' and path.endswith('/logout'):
        if session_id:
            cur.execute("SELECT user_id FROM sessions WHERE id=%s", (session_id,))
            row = cur.fetchone()
            if row:
                cur.execute("UPDATE users SET status='offline' WHERE id=%s", (row[0],))
            cur.execute("DELETE FROM sessions WHERE id=%s", (session_id,))
            conn.commit()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True})}

    # GET /me
    if method == 'GET' and path.endswith('/me'):
        if not session_id:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Не авторизован'})}
        cur.execute(
            "SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, u.custom_status, u.email FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.id=%s",
            (session_id,)
        )
        row = cur.fetchone()
        if not row:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Сессия истекла'})}
        return {
            'statusCode': 200, 'headers': CORS,
            'body': json.dumps({'user': {'id': row[0], 'username': row[1], 'display_name': row[2], 'avatar_color': row[3], 'status': row[4], 'custom_status': row[5], 'email': row[6]}})
        }

    # PUT /profile
    if method == 'PUT' and path.endswith('/profile'):
        if not session_id:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Не авторизован'})}
        cur.execute("SELECT user_id FROM sessions WHERE id=%s", (session_id,))
        row = cur.fetchone()
        if not row:
            return {'statusCode': 401, 'headers': CORS, 'body': json.dumps({'error': 'Сессия истекла'})}
        user_id = row[0]
        display_name = body.get('display_name')
        custom_status = body.get('custom_status')
        status = body.get('status')
        if display_name:
            cur.execute("UPDATE users SET display_name=%s WHERE id=%s", (display_name, user_id))
        if custom_status is not None:
            cur.execute("UPDATE users SET custom_status=%s WHERE id=%s", (custom_status, user_id))
        if status:
            cur.execute("UPDATE users SET status=%s WHERE id=%s", (status, user_id))
        conn.commit()
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'ok': True})}

    return {'statusCode': 404, 'headers': CORS, 'body': json.dumps({'error': 'Not found'})}

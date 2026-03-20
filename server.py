from gevent import monkey
monkey.patch_all()

import uuid
import time
import socket as _socket

from flask import Flask, send_file, jsonify, request
from flask_socketio import SocketIO, emit, disconnect

app = Flask(__name__, static_folder='.', static_url_path='')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='gevent',
                    logger=False, engineio_logger=False)

MAX_PLAYERS = 16
players      = {}       # sid → dict
display_sids = set()    # sids des écrans de jeu


def get_local_ip():
    try:
        s = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


# ── Routes HTTP ──────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_file('index.html')

@app.route('/mobile')
def mobile():
    return send_file('mobile.html')

@app.route('/api/info')
def api_info():
    ip = get_local_ip()
    return jsonify({'server_url': f'http://{ip}:5000'})


# ── Événements SocketIO ──────────────────────────────────────────────────────

@socketio.on('connect')
def on_connect():
    pass  # attendre l'inscription

@socketio.on('register_display')
def on_register_display():
    display_sids.add(request.sid)
    mobile_players = [
        {'player_id': p['id'], 'name': p['name'], 'color': p['color']}
        for p in players.values() if p.get('type') == 'mobile'
    ]
    emit('player_list', mobile_players)

@socketio.on('register_mobile')
def on_register_mobile(data):
    mobile_count = sum(1 for p in players.values() if p.get('type') == 'mobile')
    if mobile_count >= MAX_PLAYERS:
        emit('game_full')
        return

    player_id = str(uuid.uuid4())[:8]
    name  = (data.get('name') or f'Joueur{mobile_count + 1}')[:20]
    color = data.get('color', '#e74c3c')

    players[request.sid] = {
        'id':          player_id,
        'name':        name,
        'color':       color,
        'type':        'mobile',
        'last_active': time.time(),
    }

    emit('assigned', {'player_id': player_id, 'name': name, 'color': color})

    msg = {'player_id': player_id, 'name': name, 'color': color}
    for sid in list(display_sids):
        socketio.emit('player_joined', msg, to=sid)

@socketio.on('input')
def on_input(data):
    p = players.get(request.sid)
    if not p or p.get('type') != 'mobile':
        return
    p['last_active'] = time.time()
    msg = {'player_id': p['id'], 'inputs': data}
    for sid in list(display_sids):
        socketio.emit('player_input', msg, to=sid)

@socketio.on('config_update')
def on_config_update(data):
    p = players.get(request.sid)
    if not p:
        return
    if 'name' in data:
        p['name'] = str(data['name'])[:20]
    if 'color' in data:
        p['color'] = data['color']
    msg = {'player_id': p['id'], 'name': p['name'], 'color': p['color']}
    for sid in list(display_sids):
        socketio.emit('player_config', msg, to=sid)

@socketio.on('heartbeat')
def on_heartbeat():
    p = players.get(request.sid)
    if p:
        p['last_active'] = time.time()

@socketio.on('disconnect')
def on_disconnect():
    display_sids.discard(request.sid)
    p = players.pop(request.sid, None)
    if p and p.get('type') == 'mobile':
        msg = {'player_id': p['id']}
        for sid in list(display_sids):
            socketio.emit('player_left', msg, to=sid)


# ── Nettoyage des joueurs inactifs ───────────────────────────────────────────

def cleanup_inactive():
    while True:
        socketio.sleep(5)
        now = time.time()
        to_kick = [
            sid for sid, p in list(players.items())
            if p.get('type') == 'mobile' and now - p.get('last_active', 0) > 20
        ]
        for sid in to_kick:
            p = players.pop(sid, None)
            if p:
                msg = {'player_id': p['id']}
                for dsid in list(display_sids):
                    socketio.emit('player_left', msg, to=dsid)
                try:
                    socketio.server.disconnect(sid)
                except Exception:
                    pass

socketio.start_background_task(cleanup_inactive)


if __name__ == '__main__':
    ip = get_local_ip()
    print(f'\n🚗  Topolino Multijoueur')
    print(f'    Affichage : http://{ip}:5000')
    print(f'    Mobile    : http://{ip}:5000/mobile')
    print(f'    (Scannez le QR code depuis l\'écran de jeu)\n')
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)

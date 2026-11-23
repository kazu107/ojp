export const DELIVERY_PYTHON_TEMPLATE = `from collections import deque
import sys

MOVES = [(0, -1, "UP"), (0, 1, "DOWN"), (-1, 0, "LEFT"), (1, 0, "RIGHT")]

def paths(board, start):
    found = {start: (0, "WAIT")}
    queue = deque([start])
    while queue:
        x, y = queue.popleft()
        distance, first = found[x, y]
        for dx, dy, action in MOVES:
            p = x + dx, y + dy
            if p not in found and board[p[1]][p[0]] != "#":
                found[p] = distance + 1, first if distance else action
                queue.append(p)
    return found

def choose(board, turn, seat, position, orders):
    routes = paths(board, position)
    held = [o for o in orders if o[-1] == seat]
    if held:
        order, _, _, x, y, *_ = min(held, key=lambda o: (o[5], o[0]))
        return f"DELIVER {order}" if position == (x, y) else routes[x, y][1]
    best, answer = 0, "WAIT"
    for order, px, py, dx, dy, deadline, base, size, owner in orders:
        if owner != -1:
            continue
        cost = routes[px, py][0] + paths(board, (px, py))[dx, dy][0] + 2
        if turn + cost - 1 <= deadline and base / cost > best:
            best = base / cost
            answer = f"PICKUP {order}" if position == (px, py) else routes[px, py][1]
    return answer

while True:
    line = sys.stdin.readline().strip()
    if not line or line == "END":
        break
    turn, seat, h, w, x, y, ox, oy, load, a, b, count = map(int, line.split())
    board = [sys.stdin.readline().strip() for _ in range(h)]
    orders = [list(map(int, sys.stdin.readline().split())) for _ in range(count)]
    print(choose(board, turn, seat, (x, y), orders), flush=True)
`;

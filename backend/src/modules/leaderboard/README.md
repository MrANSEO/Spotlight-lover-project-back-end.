# Module Leaderboard - Spotlight Lover

Module de classement en temps réel avec WebSocket et endpoints REST pour suivre la compétition des candidats.

## 📋 Vue d'ensemble

Le module Leaderboard gère :
- ✅ **Classement en temps réel** avec WebSocket (mises à jour toutes les 10s)
- ✅ **Top 100 candidats** triés par votes et revenus
- ✅ **Statistiques globales** (total candidats, votes, revenus)
- ✅ **Classement par pays**
- ✅ **Compétitions serrées** (écart < 10 votes)
- ✅ **Candidats montants** (plus grande progression)
- ✅ **Position individuelle** d'un candidat
- ✅ **Cache intelligent** pour optimiser les performances

## 🎯 Fonctionnalités clés

### WebSocket (Temps réel)
- Connexion sur namespace `/leaderboard`
- Mise à jour automatique toutes les 10 secondes
- Push immédiat lors de votes confirmés
- Calcul des changements de rang et progression

### REST API
- Endpoints publics pour consultation
- Endpoint admin pour rafraîchissement forcé
- Filtrage par pays
- Top N candidats personnalisable

## 🌐 WebSocket API

### Connexion au WebSocket

**URL:** `ws://localhost:4000/leaderboard`

**Exemple client JavaScript:**
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000/leaderboard', {
  transports: ['websocket'],
  withCredentials: true
});

// Connexion établie
socket.on('connect', () => {
  console.log('✅ Connecté au leaderboard');
});

// Déconnexion
socket.on('disconnect', () => {
  console.log('❌ Déconnecté du leaderboard');
});

// Erreur
socket.on('connect_error', (error) => {
  console.error('Erreur de connexion:', error);
});
```

---

### Événement: `leaderboard:initial`

Reçu immédiatement après connexion.

**Payload:**
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "candidateId": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Alice Kamara",
      "country": "Cameroun",
      "city": "Yaoundé",
      "videoUrl": "https://...",
      "thumbnailUrl": "https://...",
      "totalVotes": 1523,
      "totalRevenue": 152300,
      "viewCount": 45892,
      "shareCount": 234,
      "voteChange": 0,
      "rankChange": 0
    }
  ],
  "stats": {
    "totalCandidates": 50,
    "totalVotes": 12540,
    "totalRevenue": 1254000,
    "lastUpdate": "2024-01-14T10:30:00.000Z"
  },
  "timestamp": "2024-01-14T10:30:00.000Z"
}
```

**Exemple:**
```javascript
socket.on('leaderboard:initial', (data) => {
  console.log('📊 Leaderboard initial:', data.leaderboard);
  console.log('📈 Stats:', data.stats);
  updateUI(data.leaderboard);
});
```

---

### Événement: `leaderboard:update`

Reçu toutes les 10 secondes (mise à jour automatique) et lors des votes confirmés.

**Payload:** Identique à `leaderboard:initial`

**Exemple:**
```javascript
socket.on('leaderboard:update', (data) => {
  console.log('🔄 Mise à jour du leaderboard');
  
  // Afficher les changements
  data.leaderboard.forEach(entry => {
    if (entry.rankChange > 0) {
      console.log(`⬆️ ${entry.name} monte de ${entry.rankChange} place(s)`);
    } else if (entry.rankChange < 0) {
      console.log(`⬇️ ${entry.name} descend de ${Math.abs(entry.rankChange)} place(s)`);
    }
    
    if (entry.voteChange > 0) {
      console.log(`✨ ${entry.name} a reçu ${entry.voteChange} nouveau(x) vote(s)`);
    }
  });
  
  updateUI(data.leaderboard);
});
```

---

### Émission: `leaderboard:refresh`

Demander un rafraîchissement immédiat du leaderboard.

**Payload:** Aucun

**Réponse:** Événement `leaderboard:initial`

**Exemple:**
```javascript
// Bouton de rafraîchissement
document.getElementById('refresh-btn').addEventListener('click', () => {
  socket.emit('leaderboard:refresh');
});
```

---

### Émission: `leaderboard:candidate-rank`

Récupérer la position d'un candidat spécifique.

**Payload:**
```json
{
  "candidateId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Réponse:** Événement `leaderboard:candidate-rank-response`
```json
{
  "candidateId": "550e8400-e29b-41d4-a716-446655440000",
  "entry": {
    "rank": 3,
    "candidateId": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Alice Kamara",
    "totalVotes": 892,
    "voteChange": 15,
    "rankChange": 1
  },
  "total": 50,
  "timestamp": "2024-01-14T10:30:00.000Z"
}
```

**Exemple:**
```javascript
// Demander la position d'un candidat
socket.emit('leaderboard:candidate-rank', {
  candidateId: 'candidate-uuid'
});

// Recevoir la réponse
socket.on('leaderboard:candidate-rank-response', (data) => {
  if (data.entry) {
    console.log(`${data.entry.name} est #${data.entry.rank} sur ${data.total}`);
  } else {
    console.log('Candidat non trouvé dans le top 100');
  }
});
```

---

### Émission: `leaderboard:top`

Récupérer le top N candidats.

**Payload:**
```json
{
  "limit": 10
}
```

**Réponse:** Événement `leaderboard:top-response`
```json
{
  "limit": 10,
  "candidates": [
    {
      "rank": 1,
      "candidateId": "...",
      "name": "Alice Kamara",
      "totalVotes": 1523
    }
  ],
  "timestamp": "2024-01-14T10:30:00.000Z"
}
```

**Exemple:**
```javascript
// Demander le top 5
socket.emit('leaderboard:top', { limit: 5 });

socket.on('leaderboard:top-response', (data) => {
  console.log(`Top ${data.limit}:`, data.candidates);
});
```

---

### Émission: `leaderboard:by-country`

Récupérer le classement par pays.

**Payload:**
```json
{
  "country": "Cameroun",
  "limit": 20
}
```

**Réponse:** Événement `leaderboard:by-country-response`
```json
{
  "country": "Cameroun",
  "leaderboard": [
    {
      "rank": 1,
      "candidateId": "...",
      "name": "Alice Kamara",
      "country": "Cameroun",
      "city": "Yaoundé",
      "totalVotes": 892
    }
  ],
  "timestamp": "2024-01-14T10:30:00.000Z"
}
```

**Exemple:**
```javascript
socket.emit('leaderboard:by-country', {
  country: 'Cameroun',
  limit: 10
});

socket.on('leaderboard:by-country-response', (data) => {
  console.log(`Classement ${data.country}:`, data.leaderboard);
});
```

---

### Événement: `leaderboard:error`

Reçu en cas d'erreur lors du traitement d'une demande.

**Payload:**
```json
{
  "message": "Impossible de récupérer le rang du candidat",
  "error": "Error details..."
}
```

**Exemple:**
```javascript
socket.on('leaderboard:error', (error) => {
  console.error('❌ Erreur:', error.message);
  showErrorNotification(error.message);
});
```

---

## 🌐 REST API Endpoints

### PUBLIC - Récupérer le leaderboard complet

**GET** `/leaderboard?limit=100`

**Query Parameters:**
- `limit` (optional): Nombre de candidats (défaut: 100)

**Response 200:**
```json
{
  "success": true,
  "message": "Leaderboard récupéré avec succès",
  "data": {
    "leaderboard": [
      {
        "rank": 1,
        "candidateId": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Alice Kamara",
        "country": "Cameroun",
        "city": "Yaoundé",
        "videoUrl": "https://...",
        "thumbnailUrl": "https://...",
        "totalVotes": 1523,
        "totalRevenue": 152300,
        "viewCount": 45892,
        "shareCount": 234,
        "voteChange": 25,
        "rankChange": 0
      }
    ],
    "stats": {
      "totalCandidates": 50,
      "totalVotes": 12540,
      "totalRevenue": 1254000,
      "lastUpdate": "2024-01-14T10:30:00.000Z"
    }
  }
}
```

**Test cURL:**
```bash
# Top 100 (défaut)
curl http://localhost:4000/leaderboard

# Top 20
curl "http://localhost:4000/leaderboard?limit=20"
```

---

### PUBLIC - Récupérer le top N candidats

**GET** `/leaderboard/top/:limit`

**Response 200:**
```json
{
  "success": true,
  "message": "Top 10 récupéré avec succès",
  "data": [
    {
      "rank": 1,
      "candidateId": "...",
      "name": "Alice Kamara",
      "totalVotes": 1523
    }
  ]
}
```

**Test cURL:**
```bash
curl http://localhost:4000/leaderboard/top/10
```

---

### PUBLIC - Récupérer les statistiques

**GET** `/leaderboard/stats`

**Response 200:**
```json
{
  "success": true,
  "message": "Statistiques récupérées avec succès",
  "data": {
    "totalCandidates": 50,
    "totalVotes": 12540,
    "totalRevenue": 1254000,
    "lastUpdate": "2024-01-14T10:30:00.000Z"
  }
}
```

**Test cURL:**
```bash
curl http://localhost:4000/leaderboard/stats
```

---

### PUBLIC - Position d'un candidat

**GET** `/leaderboard/candidate/:id`

**Response 200:**
```json
{
  "success": true,
  "message": "Position du candidat récupérée avec succès",
  "data": {
    "entry": {
      "rank": 3,
      "candidateId": "...",
      "name": "Alice Kamara",
      "totalVotes": 892,
      "voteChange": 15,
      "rankChange": 1
    },
    "total": 50
  }
}
```

**Test cURL:**
```bash
curl http://localhost:4000/leaderboard/candidate/550e8400-e29b-41d4-a716-446655440000
```

---

### PUBLIC - Classement par pays

**GET** `/leaderboard/country/:country?limit=20`

**Response 200:**
```json
{
  "success": true,
  "message": "Classement pour Cameroun récupéré avec succès",
  "data": [
    {
      "rank": 1,
      "candidateId": "...",
      "name": "Alice Kamara",
      "country": "Cameroun",
      "totalVotes": 892
    }
  ]
}
```

**Test cURL:**
```bash
curl "http://localhost:4000/leaderboard/country/Cameroun?limit=10"
```

---

### PUBLIC - Compétitions serrées

**GET** `/leaderboard/tight-races?limit=10`

Récupère les candidats en compétition serrée (écart < 10 votes).

**Response 200:**
```json
{
  "success": true,
  "message": "Compétitions serrées récupérées avec succès",
  "data": [
    {
      "candidate1": {
        "rank": 5,
        "name": "Alice Kamara",
        "totalVotes": 523
      },
      "candidate2": {
        "rank": 6,
        "name": "Mamadou Diallo",
        "totalVotes": 518
      },
      "voteDifference": 5
    }
  ]
}
```

**Test cURL:**
```bash
curl "http://localhost:4000/leaderboard/tight-races?limit=5"
```

---

### PUBLIC - Candidats montants

**GET** `/leaderboard/rising-stars?limit=10`

Récupère les candidats avec la plus grande progression.

**Response 200:**
```json
{
  "success": true,
  "message": "Candidats montants récupérés avec succès",
  "data": [
    {
      "rank": 12,
      "candidateId": "...",
      "name": "Fatou Sow",
      "totalVotes": 345,
      "voteChange": 87,
      "rankChange": 8
    }
  ]
}
```

**Test cURL:**
```bash
curl "http://localhost:4000/leaderboard/rising-stars?limit=5"
```

---

### ADMIN - Forcer le rafraîchissement

**POST** `/leaderboard/refresh`

🔒 **Authentification requise** (SUPER_ADMIN, MODERATOR)

Force le recalcul du leaderboard et déclenche une mise à jour WebSocket.

**Response 200:**
```json
{
  "success": true,
  "message": "Leaderboard rafraîchi avec succès",
  "data": [...]
}
```

**Test cURL:**
```bash
curl -X POST http://localhost:4000/leaderboard/refresh \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## 🔄 Flux de mise à jour automatique

### 1. Mise à jour périodique (toutes les 10s)

```
LeaderboardGateway (setInterval)
        ↓
  refreshLeaderboard()
        ↓
  PrismaService (query candidats APPROVED)
        ↓
  Calcul des rangs et changements
        ↓
  Mise à jour du cache
        ↓
  Broadcast WebSocket à tous les clients
```

### 2. Mise à jour lors d'un vote confirmé

```
VotesService.confirmPayment()
        ↓
  Candidate totalVotes++
        ↓
  LeaderboardGateway.triggerUpdate()
        ↓
  refreshLeaderboard()
        ↓
  Broadcast WebSocket immédiat
```

---

## 📊 Algorithme de classement

### Ordre de tri:
1. **totalVotes** (DESC) - Nombre de votes
2. **totalRevenue** (DESC) - Revenus générés
3. **createdAt** (ASC) - Ancienneté (en cas d'égalité)

### Calcul des changements:
- **voteChange**: `currentVotes - cachedVotes`
- **rankChange**: `cachedRank - currentRank`
  - Positif = montée dans le classement
  - Négatif = descente dans le classement

---

## 🚀 Exemple d'intégration frontend (React)

```javascript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function LeaderboardComponent() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [stats, setStats] = useState({});
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Connexion WebSocket
    const newSocket = io('http://localhost:4000/leaderboard', {
      transports: ['websocket'],
    });

    // Leaderboard initial
    newSocket.on('leaderboard:initial', (data) => {
      console.log('📊 Leaderboard initial reçu');
      setLeaderboard(data.leaderboard);
      setStats(data.stats);
    });

    // Mises à jour en temps réel
    newSocket.on('leaderboard:update', (data) => {
      console.log('🔄 Mise à jour du leaderboard');
      setLeaderboard(data.leaderboard);
      setStats(data.stats);
      
      // Animations de changement de rang
      data.leaderboard.forEach(entry => {
        if (entry.rankChange !== 0) {
          showRankChangeAnimation(entry);
        }
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const handleRefresh = () => {
    if (socket) {
      socket.emit('leaderboard:refresh');
    }
  };

  return (
    <div>
      <h1>Classement en Temps Réel</h1>
      <button onClick={handleRefresh}>🔄 Rafraîchir</button>
      
      <div className="stats">
        <p>Total candidats: {stats.totalCandidates}</p>
        <p>Total votes: {stats.totalVotes}</p>
      </div>

      <div className="leaderboard">
        {leaderboard.map((entry) => (
          <div key={entry.candidateId} className="leaderboard-entry">
            <span className="rank">#{entry.rank}</span>
            <span className="name">{entry.name}</span>
            <span className="votes">{entry.totalVotes} votes</span>
            
            {entry.rankChange > 0 && (
              <span className="rank-up">⬆️ +{entry.rankChange}</span>
            )}
            {entry.rankChange < 0 && (
              <span className="rank-down">⬇️ {entry.rankChange}</span>
            )}
            {entry.voteChange > 0 && (
              <span className="vote-change">+{entry.voteChange} 🗳️</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default LeaderboardComponent;
```

---

## 🔒 Sécurité & Performance

### CORS
- Configuré pour accepter les connexions depuis `FRONTEND_URL`
- Credentials: true

### Cache
- Leaderboard mis en cache dans `LeaderboardService`
- Calcul des changements basé sur le cache précédent
- Rafraîchissement intelligent

### Optimisations
- Requêtes limitées au top 100
- Index sur `totalVotes`, `totalRevenue`, `createdAt`
- Mise à jour différentielle (seulement les changements)

---

## 📝 Variables d'environnement

Ajouter dans `.env`:

```env
# Frontend URL pour CORS WebSocket
FRONTEND_URL=http://localhost:3000
```

---

## 🧪 Tests

### Test WebSocket avec wscat

```bash
# Installer wscat
npm install -g wscat

# Se connecter au leaderboard
wscat -c "ws://localhost:4000/leaderboard"

# Écouter les événements
> connected (press CTRL+C to quit)

# Demander un rafraîchissement
> 42["leaderboard:refresh"]

# Demander la position d'un candidat
> 42["leaderboard:candidate-rank",{"candidateId":"candidate-uuid"}]
```

### Test REST API

```bash
# Vérifier le leaderboard
curl http://localhost:4000/leaderboard | jq '.data.leaderboard[0]'

# Vérifier les stats
curl http://localhost:4000/leaderboard/stats | jq '.data'

# Top 5
curl http://localhost:4000/leaderboard/top/5 | jq '.data'
```

---

## 🚀 Prochaines étapes

- [ ] Tests unitaires pour LeaderboardService
- [ ] Tests E2E pour WebSocket
- [ ] Analytics des performances
- [ ] Dashboard admin avec graphiques en temps réel
- [ ] Notifications push lors de changements de rang

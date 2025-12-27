import React, { useState, useEffect } from 'react';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, update, runTransaction } from "firebase/database";
import './App.css';
import { remove } from "firebase/database";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAE7yFc0C5KGl31I5_QH6e36jo8pIV1J_w",
  authDomain: "who-s-that-porkemon-discord.firebaseapp.com",
  databaseURL: "https://who-s-that-porkemon-discord-default-rtdb.firebaseio.com",
  projectId: "who-s-that-porkemon-discord",
  storageBucket: "who-s-that-porkemon-discord.firebasestorage.app",
  messagingSenderId: "284864508530",
  appId: "1:284864508530:web:7dcfc8b034621825f4c8eb"
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Constants
const TOTAL_POKEMON = 151;
const WINNING_SCORE = 3;
const MAX_PLAYERS = 4;

function App() {
  // State variables
  const [gameState, setGameState] = useState('MENU');
  const [roomCode, setRoomCode] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isHost, setIsHost] = useState(false);
  
  const [players, setPlayers] = useState({});
  const [currentRound, setCurrentRound] = useState(null);
  const [winner, setWinner] = useState(null);
  const [pokemonList, setPokemonList] = useState([]);

  // Fetch Pokemon on component mount
  useEffect(() => {
    fetch('https://pokeapi.co/api/v2/pokemon?limit=151')
      .then(res => res.json())
      .then(data => {
        setPokemonList(data.results.map((p, index) => ({ 
          name: p.name, 
          id: index + 1 
        })));
      });
  }, []);

  // Firebase sync effect
  useEffect(() => {
    if (!roomCode) return;

    const gameRef = ref(db, `rooms/${roomCode}`);
    const unsubscribe = onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      
      if (data) {
        setPlayers(data.players || {});
        
        // Determine host
        const playerIds = Object.keys(data.players || {});
        setIsHost(playerIds[0] === playerId);

        // Check for current round
        if (data.currentRound) {
          setCurrentRound(data.currentRound);
          setGameState('GAME');
        }

        // Check for winner
        const winnerId = playerIds.find(
          pid => data.players[pid].score >= WINNING_SCORE
        );
        
        if (winnerId) {
          setWinner(data.players[winnerId].name);
          setGameState('WIN');
        }
      }
    });

    return () => unsubscribe();
  }, [roomCode, playerId]);

  // Room creation
  const createRoom = () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const newPlayerId = Date.now().toString();
    
    setRoomCode(code);
    setPlayerId(newPlayerId);
    setGameState('LOBBY');
    setIsHost(true);
    
    set(ref(db, `rooms/${code}`), {
      status: 'LOBBY',
      players: {
        [newPlayerId]: { name: playerName, score: 0 }
      }
    });
  };

  // Join room
  const joinRoom = (code) => {
    const gameRef = ref(db, `rooms/${code}`);
    onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        alert('Room does not exist');
        return;
      }

      const playerCount = Object.keys(data.players || {}).length;
      if (playerCount >= MAX_PLAYERS) {
        alert(`Room is full. Maximum ${MAX_PLAYERS} players allowed.`);
        return;
      }

      const newPlayerId = Date.now().toString();
      setRoomCode(code);
      setPlayerId(newPlayerId);
      setGameState('LOBBY');
      setIsHost(false);

      update(ref(db, `rooms/${code}/players`), {
        [newPlayerId]: { name: playerName, score: 0 }
      });
    }, { onlyOnce: true });
  };

  // Start game
  const startGame = () => {
    if (!isHost) {
      alert('Only the host can start the game');
      return;
    }

    const playerIds = Object.keys(players);
    if (playerIds.length < 1) {
      alert('Need at least 1 player to start');
      return;
    }

    nextRound(roomCode);
  };

  // Next round
  const nextRound = (code) => {
    const correctId = Math.floor(Math.random() * TOTAL_POKEMON) + 1;
    const options = new Set([correctId]);
    
    while(options.size < 4) {
      options.add(Math.floor(Math.random() * TOTAL_POKEMON) + 1);
    }
    
    const shuffledOptions = Array.from(options).sort(() => Math.random() - 0.5);

    update(ref(db, `rooms/${code}`), {
      currentRound: {
        correctId,
        options: shuffledOptions,
        revealed: false,
        roundWinner: null
      },
      status: 'IN_GAME'
    });
  };

  // Guess handler
  const handleGuess = (guessId) => {
    if (currentRound.revealed) return;

    if (guessId === currentRound.correctId) {
      const roundRef = ref(db, `rooms/${roomCode}/currentRound`);
      runTransaction(roundRef, (round) => {
        if (round && !round.revealed) {
          round.revealed = true;
          round.roundWinner = playerName;
          return round;
        }
        return;
      }).then((result) => {
        if (result.committed) {
          const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}/score`);
          runTransaction(playerRef, (score) => (score || 0) + 1);
          
          setTimeout(() => nextRound(roomCode), 3000);
        }
      });
    }
  };

  const resetLobby = () => {
  if (!roomCode) return;

  // Remove current round and reset player scores
  const lobbyRef = ref(db, `rooms/${roomCode}`);
  update(lobbyRef, {
    status: 'LOBBY',
    currentRound: null,
    players: Object.fromEntries(
      Object.entries(players).map(([id, player]) => [
        id, 
        { name: player.name, score: 0 }
      ])
    )
  });

  // Reset local state
  setGameState('LOBBY');
  setCurrentRound(null);
  setWinner(null);
  };

  const backToMenu = () => {
    if (!roomCode) return;

    // Remove the player from the room
    const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}`);
    remove(playerRef);

    // Reset local state
    setGameState('MENU');
    setRoomCode('');
    setPlayerId('');
    setPlayers({});
    setCurrentRound(null);
    setWinner(null);
  };

  // Render method
  return (
    <div className="App">
      {gameState === 'MENU' && (
        <div className="container">
          <h1>Who's That Pokémon?</h1>
          <input 
            placeholder="Enter Your Name" 
            value={playerName} 
            onChange={e => setPlayerName(e.target.value)} 
          />
          <div className="menu-buttons">
            <button disabled={!playerName} onClick={createRoom}>Create Room</button>
            <div className="join-group">
              <input id="room-input" placeholder="Room Code" />
              <button 
                disabled={!playerName} 
                onClick={() => joinRoom(document.getElementById('room-input').value.toUpperCase())}
              >
                Join Room
              </button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'LOBBY' && (
        <div className="container">
          <h2>Room Code: {roomCode}</h2>
          <div className="player-list">
            {Object.values(players).map((p, i) => (
              <div key={i} className="player-card">
                {p.name}
              </div>
            ))}
          </div>
          {Object.values(players).length >= 1 && (
            <button className="start-btn" onClick={startGame}>
              Start Game (Min 1 Player)
            </button>
          )}
        </div>
      )}

      {gameState === 'GAME' && currentRound && (
        <div className="game-container">
          <div className="scoreboard">
            {Object.values(players).map(p => (
              <div 
                key={p.name} 
                className={p.name === currentRound.roundWinner ? 'score update' : 'score'}
              >
                {p.name}: {p.score}
              </div>
            ))}
          </div>

          <div className="pokemon-display">
            <img 
              src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${currentRound.correctId}.png`}
              className={currentRound.revealed ? 'revealed' : 'silhouette'} 
              alt="Who is it?"
            />
            {currentRound.revealed && (
              <h2 className="reveal-text">
                It's {pokemonList.find(p => p.id === currentRound.correctId)?.name}!
              </h2>
            )}
          </div>

          <div className="options-grid">
            {currentRound.options.map(id => {
              const p = pokemonList.find(poke => poke.id === id);
              return (
                <button 
                  key={id} 
                  onClick={() => handleGuess(id)}
                  disabled={currentRound.revealed}
                  className={currentRound.revealed && id === currentRound.correctId ? 'correct-btn' : ''}
                >
                  {p?.name.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      )}

       {gameState === 'WIN' && (
        <div className="container">
          <h1>🏆 {winner} Wins! 🏆</h1>
          <div className="win-buttons">
            <button onClick={resetLobby}>Play Again</button>
            <button onClick={backToMenu}>No Thanks</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
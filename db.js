// ============================================
// 暗記マスター - Database Schema (Dexie.js)
// ============================================

const db = new Dexie('MemoryAppDB');

// Version 1: Original schema
db.version(1).stores({
    cards: 'id, category, nextReview, level',
    decks: 'id, name',
    marketing: '++id, date, action'
});

// Version 2: Add sync-related fields
db.version(2).stores({
    cards: 'id, category, nextReview, level, updatedAt, synced, deleted',
    decks: 'id, name, updatedAt, synced, deleted',
    marketing: '++id, date, action'
}).upgrade(tx => {
    return tx.table('cards').toCollection().modify(card => {
        if (!card.updatedAt) card.updatedAt = card.createdAt || new Date().toISOString();
        if (card.synced === undefined) card.synced = 0;
        if (card.deleted === undefined) card.deleted = 0;
    }).then(() => {
        return tx.table('decks').toCollection().modify(deck => {
            if (!deck.updatedAt) deck.updatedAt = new Date().toISOString();
            if (deck.synced === undefined) deck.synced = 0;
            if (deck.deleted === undefined) deck.deleted = 0;
        });
    });
});



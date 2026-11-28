import type {HorizonWatchlist} from '@prisma/client';
import {hashValue} from '../regulatory/intelligence';
import {MAX_WATCHLISTS, watchlistFilters, watchlistMutation, type HorizonWatch} from '../horizon/watchlists';
import type {AuthorizedContext} from './authorization';
import {IntelligenceError, transaction} from './intelligence-service';
import {ADMIN, requireMember} from './workspace-member';

export function viewWatchlist(row: HorizonWatchlist): HorizonWatch {
  return {id: row.id, name: row.name, version: row.version, archived: row.archived, filters: watchlistFilters.parse(row.filters)};
}

export async function changeHorizonWatchlist(ctx: AuthorizedContext, input: unknown) {
  const change = watchlistMutation.parse(input);
  return transaction(ctx, async tx => {
    await requireMember(tx, ctx, ADMIN);
    const key = {organizationId: ctx.organizationId, id: change.id};
    const where = {organizationId_id: key};
    const previous = await tx.horizonWatchlist.findUnique({where});
    if (previous && previous.version === change.version + 1 && previous.changedById === ctx.userId) {
      const sameChange = change.action === 'archive' ? previous.archived :
        !previous.archived && previous.name === change.name && hashValue(previous.filters) === hashValue(change.filters);
      if (sameChange) return viewWatchlist(previous);
    }
    if (!previous && change.version !== 0) throw new IntelligenceError('Watchlist unavailable in this workspace.', 404);
    if (previous && (previous.archived || previous.version !== change.version)) {
      throw new IntelligenceError('This watchlist changed. Reload the workspace watchlists before saving.', 409);
    }

    let saved: HorizonWatchlist;
    if (change.action === 'archive') {
      saved = await tx.horizonWatchlist.update({where, data:{archived:true, changedById:ctx.userId, version:{increment:1}}});
    } else {
      const scope = {organizationId: ctx.organizationId, archived: false};
      const active = await tx.horizonWatchlist.findMany({where:scope,select:{id:true,name:true},take:MAX_WATCHLISTS});
      const nameKey = (name:string) => name.normalize('NFKC').toLowerCase();
      if (active.some(row=>row.id!==change.id && nameKey(row.name)===nameKey(change.name))) {
        throw new IntelligenceError('An active watchlist already uses this name.', 409);
      }
      if (!previous && active.length >= MAX_WATCHLISTS) {
        throw new IntelligenceError('Archive a watchlist before adding another. Each workspace can keep 20 active watchlists.', 409);
      }
      const data = {name:change.name, filters:change.filters, changedById:ctx.userId};
      saved = previous
        ? await tx.horizonWatchlist.update({where,data:{...data,version:{increment:1}}})
        : await tx.horizonWatchlist.create({data:{...key,...data}});
    }
    await tx.auditEvent.create({data:{
      organizationId:ctx.organizationId, actorId:ctx.userId, entityType:'HorizonWatchlist', entityId:saved.id,
      action:change.action === 'archive' ? 'horizon.watchlist_archived' : previous ? 'horizon.watchlist_updated' : 'horizon.watchlist_created',
      details:{version:saved.version,name:saved.name,filtersHash:hashValue(saved.filters)},
    }});
    return viewWatchlist(saved);
  });
}

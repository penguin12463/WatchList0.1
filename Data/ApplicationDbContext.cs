using Microsoft.EntityFrameworkCore;

namespace WatchList0._1.Data
{
    public class ApplicationDbContext : DbContext
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

        public DbSet<UserEntity> Users { get; set; } = null!;
        public DbSet<WatchListEntity> WatchLists { get; set; } = null!;
        public DbSet<MovieEntity> Movies { get; set; } = null!;
        public DbSet<WatchListShareInvitationEntity> WatchListShareInvitations { get; set; } = null!;

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<UserEntity>()
                .HasMany(u => u.WatchLists)
                .WithOne(w => w.User)
                .HasForeignKey(w => w.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<WatchListEntity>()
                .HasMany(w => w.Movies)
                .WithMany(m => m.WatchLists)
                .UsingEntity<Dictionary<string, object>>(
                    "WatchListMovies",
                    r => r.HasOne<MovieEntity>()
                        .WithMany()
                        .HasForeignKey("MovieId")
                        .OnDelete(DeleteBehavior.Cascade),
                    l => l.HasOne<WatchListEntity>()
                        .WithMany()
                        .HasForeignKey("WatchListId")
                        .OnDelete(DeleteBehavior.Cascade),
                    j =>
                    {
                        j.ToTable("WatchListMovies");
                        j.HasKey("WatchListId", "MovieId");
                    });

            modelBuilder.Entity<WatchListEntity>()
                .HasMany(w => w.SharedWithUsers)
                .WithMany(u => u.SharedWatchLists)
                .UsingEntity<Dictionary<string, object>>(
                    "WatchListShares",
                    r => r.HasOne<UserEntity>()
                        .WithMany()
                        .HasForeignKey("UserId")
                        .OnDelete(DeleteBehavior.Cascade),
                    l => l.HasOne<WatchListEntity>()
                        .WithMany()
                        .HasForeignKey("WatchListId")
                        .OnDelete(DeleteBehavior.Cascade),
                    j =>
                    {
                        j.ToTable("WatchListShares");
                        j.HasKey("WatchListId", "UserId");
                    });

            modelBuilder.Entity<MovieEntity>()
                .HasIndex(m => new { m.MediaType, m.TmdbId })
                .IsUnique();

            modelBuilder.Entity<WatchListShareInvitationEntity>()
                .HasOne(i => i.WatchList)
                .WithMany(w => w.ShareInvitations)
                .HasForeignKey(i => i.WatchListId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<WatchListShareInvitationEntity>()
                .HasOne(i => i.User)
                .WithMany(u => u.ShareInvitations)
                .HasForeignKey(i => i.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<WatchListShareInvitationEntity>()
                .HasIndex(i => new { i.WatchListId, i.UserId })
                .IsUnique();

            base.OnModelCreating(modelBuilder);
        }
    }
}

using WatchList0._1.Components;
using WatchList0._1.Services;
using WatchList0._1.Data;
using WatchList0._1.Components.Auth;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Identity;
using System.Data.Common;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddAuthentication("cookie")
    .AddCookie("cookie", options =>
    {
        options.LoginPath = "/signin";
        options.LogoutPath = "/signout";
        options.Cookie.Name = "watchlyst_auth_v2";
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
    });

builder.Services.AddAuthorizationCore();

// HttpContext is needed to call SignInAsync from a component
builder.Services.AddHttpContextAccessor();

// Register custom AuthenticationStateProvider for server-side auth
builder.Services.AddScoped<AuthenticationStateProvider, ServerAuthenticationStateProvider>();

// Register the database and user service
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection") ?? "Data Source=watchlist.db"));

builder.Services.AddScoped<IUserService, UserService>();

// Add controllers for API endpoints
builder.Services.AddControllers();

// Add HttpClient for interactive components

builder.Services.AddHttpClient();
builder.Services.AddScoped<TmdbService>();

var app = builder.Build();

// Remove all movies with 'paul' in the title if requested
if (args.Contains("--remove-paul"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    var pauls = db.Movies.Where(m => m.Title.ToLower().Contains("paul")).ToList();
    if (pauls.Count > 0)
    {
        db.Movies.RemoveRange(pauls);
        db.SaveChanges();
        Console.WriteLine($"Removed {pauls.Count} movies with 'paul' in the title.");
    }
    else
    {
        Console.WriteLine("No movies with 'paul' in the title found.");
    }
    return;
}

// Ensure database is created and seed demo data if needed
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

    if (NeedsSchemaResetForSharedMovies(db))
    {
        db.Database.EnsureDeleted();
    }

    db.Database.EnsureCreated();
    EnsureWatchListSharesTable(db);
    EnsureWatchListShareInvitationsTable(db);
    EnsureMovieProgressColumns(db);

    if (!db.Users.Any())
    {
        var hasher = new PasswordHasher<UserEntity>();

        var alice = new UserEntity { Id = "1", Username = "alice", Password = string.Empty };
        alice.Password = hasher.HashPassword(alice, "password");

        var bob = new UserEntity { Id = "2", Username = "bob", Password = string.Empty };
        bob.Password = hasher.HashPassword(bob, "password");

        db.Users.AddRange(alice, bob);

        var list = new WatchListEntity { Name = "Alice's Watchlist", User = alice };
        list.Movies.Add(new MovieEntity { Title = "The Matrix" });
        db.WatchLists.Add(list);

        db.SaveChanges();
    }
}

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();

app.MapStaticAssets();
app.MapControllers();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();

static bool NeedsSchemaResetForSharedMovies(ApplicationDbContext db)
{
    try
    {
        using var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            connection.Open();
        }

        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA table_info('Movies');";

        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var columnName = reader[1]?.ToString();
            if (string.Equals(columnName, "WatchListEntityId", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
    }
    catch
    {
        return false;
    }

    return false;
}

static void EnsureWatchListSharesTable(ApplicationDbContext db)
{
    db.Database.ExecuteSqlRaw(@"
CREATE TABLE IF NOT EXISTS WatchListShares (
    WatchListId INTEGER NOT NULL,
    UserId TEXT NOT NULL,
    CONSTRAINT PK_WatchListShares PRIMARY KEY (WatchListId, UserId),
    CONSTRAINT FK_WatchListShares_WatchLists_WatchListId FOREIGN KEY (WatchListId) REFERENCES WatchLists (Id) ON DELETE CASCADE,
    CONSTRAINT FK_WatchListShares_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);");

    db.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_WatchListShares_UserId ON WatchListShares (UserId);");
}

static void EnsureWatchListShareInvitationsTable(ApplicationDbContext db)
{
    db.Database.ExecuteSqlRaw(@"
CREATE TABLE IF NOT EXISTS WatchListShareInvitations (
    Id INTEGER NOT NULL CONSTRAINT PK_WatchListShareInvitations PRIMARY KEY AUTOINCREMENT,
    WatchListId INTEGER NOT NULL,
    UserId TEXT NOT NULL,
    CONSTRAINT FK_WatchListShareInvitations_WatchLists_WatchListId FOREIGN KEY (WatchListId) REFERENCES WatchLists (Id) ON DELETE CASCADE,
    CONSTRAINT FK_WatchListShareInvitations_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
);");

    db.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_WatchListShareInvitations_WatchListId_UserId ON WatchListShareInvitations (WatchListId, UserId);");
    db.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_WatchListShareInvitations_UserId ON WatchListShareInvitations (UserId);");
}

static void EnsureMovieProgressColumns(ApplicationDbContext db)
{
    try
    {
        using var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            connection.Open();
        }

        var existingColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "PRAGMA table_info('Movies');";
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var columnName = reader[1]?.ToString();
                if (!string.IsNullOrWhiteSpace(columnName))
                {
                    existingColumns.Add(columnName);
                }
            }
        }

        if (!existingColumns.Contains("WatchedRuntime"))
        {
            db.Database.ExecuteSqlRaw("ALTER TABLE Movies ADD COLUMN WatchedRuntime INTEGER NULL;");
        }

        if (!existingColumns.Contains("WatchedEpisodes"))
        {
            db.Database.ExecuteSqlRaw("ALTER TABLE Movies ADD COLUMN WatchedEpisodes INTEGER NULL;");
        }

        if (!existingColumns.Contains("Rating"))
        {
            db.Database.ExecuteSqlRaw("ALTER TABLE Movies ADD COLUMN Rating INTEGER NULL;");
        }
    }
    catch
    {
    }
}
